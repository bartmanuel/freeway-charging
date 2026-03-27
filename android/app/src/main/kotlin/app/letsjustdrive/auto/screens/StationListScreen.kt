package app.letsjustdrive.auto.screens

import android.content.Intent
import android.net.Uri
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.*
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import app.letsjustdrive.auto.api.ApiClient
import app.letsjustdrive.auto.models.PlaceSuggestion
import app.letsjustdrive.auto.models.StationOnRoute
import app.letsjustdrive.auto.util.CorridorFilter
import app.letsjustdrive.auto.util.LocationUtils
import app.letsjustdrive.auto.util.PolylineDecoder
import kotlinx.coroutines.*
import kotlin.math.roundToInt

/**
 * Shows charging stations along the route in a [PlaceListMapTemplate].
 *
 * The screen starts in a loading state while it:
 *   1. Gets the user's last-known GPS location.
 *   2. Calls /api/route (Cloudflare Worker → Google Routes API v2).
 *   3. Calls /api/stations/corridor with the polyline bounding box.
 *   4. Filters stations client-side to a 3 km corridor using [CorridorFilter].
 *
 * The car host renders the map with a blue pin for each station automatically
 * based on the [Place] metadata attached to each [Row].
 *
 * Tapping a station fires [CarContext.ACTION_NAVIGATE], which opens Google Maps
 * (or whichever navigation app the car host prefers) with the station as a waypoint.
 */
class StationListScreen(
    carContext: CarContext,
    private val destination: PlaceSuggestion,
) : Screen(carContext) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private var isLoading = true
    private var stations: List<StationOnRoute> = emptyList()
    private var routeDistanceKm = 0
    private var routeDurationMin = 0
    private var errorMessage: String? = null

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) = scope.cancel()
        })
        loadData()
    }

    // ── Template ──────────────────────────────────────────────────────────────

    override fun onGetTemplate(): Template {
        val title = "Charging \u2192 ${destination.mainText}"

        errorMessage?.let { msg ->
            return MessageTemplate.Builder(msg)
                .setTitle("Could not load stations")
                .setHeaderAction(Action.BACK)
                .addAction(
                    Action.Builder()
                        .setTitle("Retry")
                        .setOnClickListener { retry() }
                        .build()
                )
                .build()
        }

        if (isLoading) {
            // PlaceListMapTemplate with setLoading(true) shows a spinner on both the
            // list and the map pane — no ItemList needed while loading.
            return PlaceListMapTemplate.Builder()
                .setLoading(true)
                .setTitle(title)
                .setHeaderAction(Action.BACK)
                .build()
        }

        // ── Loaded ────────────────────────────────────────────────────────────

        val subtitle = "$routeDistanceKm km · ${formatDuration(routeDurationMin)} · " +
                "${stations.size} charger${if (stations.size != 1) "s" else ""}"

        val listBuilder = ItemList.Builder()

        if (stations.isEmpty()) {
            listBuilder.setNoItemsMessage(
                "No DC fast chargers found within 3 km of this route."
            )
        } else {
            // Car App Library allows up to 6 items in PlaceListMapTemplate by default;
            // the host may support more. We cap at 12 for readability.
            stations.take(12).forEach { sor ->
                listBuilder.addItem(buildStationRow(sor))
            }
        }

        return PlaceListMapTemplate.Builder()
            .setTitle(title)
            .setHeaderAction(Action.BACK)
            .setCurrentLocationEnabled(true)
            .setItemList(listBuilder.build())
            .build()
    }

    // ── Row builder ───────────────────────────────────────────────────────────

    private fun buildStationRow(sor: StationOnRoute): Row {
        val s = sor.station
        val distKm = (sor.distanceAlongRouteMeters / 1000.0).roundToInt()
        val detourKm = sor.detourMeters / 1000.0

        val detail = buildString {
            append("${s.maxPowerKw} kW")
            s.totalStalls?.let { append(" \u00b7 $it stalls") }
            append(" \u00b7 ${distKm} km along route")
            if (detourKm >= 0.2) append(" \u00b7 +${String.format("%.1f", detourKm)} km detour")
        }

        return Row.Builder()
            .setTitle(s.name)
            .addText(detail)
            // Place metadata tells the car host where to render the map pin
            .setMetadata(
                Metadata.Builder()
                    .setPlace(
                        Place.Builder(CarLocation.create(s.lat, s.lng))
                            .setMarker(
                                PlaceMarker.Builder()
                                    .setColor(CarColor.BLUE)
                                    .build()
                            )
                            .build()
                    )
                    .build()
            )
            .setOnClickListener { navigateTo(sor) }
            .build()
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    /**
     * Fires [CarContext.ACTION_NAVIGATE] to open the car's navigation app
     * (typically Google Maps) and route to the station as a waypoint.
     *
     * geo: URI scheme: https://developers.google.com/maps/documentation/urls/android-intents
     */
    private fun navigateTo(sor: StationOnRoute) {
        val s = sor.station
        val label = Uri.encode(s.name)
        val geoUri = Uri.parse("geo:${s.lat},${s.lng}?q=${s.lat},${s.lng}($label)")
        try {
            carContext.startCarApp(Intent(CarContext.ACTION_NAVIGATE, geoUri))
        } catch (e: Exception) {
            // startCarApp can throw if no navigation app is installed — unlikely
            // on a car head unit but we handle it gracefully
        }
    }

    // ── Data loading ──────────────────────────────────────────────────────────

    private fun loadData() {
        isLoading = true
        errorMessage = null
        scope.launch {
            try {
                val location = withContext(Dispatchers.IO) {
                    LocationUtils.getLastKnownLocation(carContext)
                } ?: throw Exception(
                    "Your location is unavailable. Make sure location services are enabled " +
                            "and try again."
                )

                val origin = "${location.latitude},${location.longitude}"
                val route = ApiClient.fetchRoute(origin, destination.fullAddress)
                val path = PolylineDecoder.decode(route.encodedPolyline)

                // Build a bounding box with ~5 km padding on each side so stations
                // right at the edge of the polyline bbox aren't missed
                val latPad = 0.045   // ≈ 5 km in latitude
                val lngPad = 0.060   // ≈ 5 km in longitude at 52°N
                val minLat = path.minOf { it.first } - latPad
                val maxLat = path.maxOf { it.first } + latPad
                val minLng = path.minOf { it.second } - lngPad
                val maxLng = path.maxOf { it.second } + lngPad

                val rawStations = ApiClient.fetchStations(
                    minLat, maxLat, minLng, maxLng,
                    route.encodedPolyline,
                )

                stations = CorridorFilter.filter(rawStations, path)
                routeDistanceKm = (route.distanceMeters / 1000.0).roundToInt()
                routeDurationMin = route.durationSeconds / 60

            } catch (e: Exception) {
                errorMessage = e.message ?: "Something went wrong. Please try again."
            } finally {
                isLoading = false
                invalidate() // triggers onGetTemplate() to re-render with results
            }
        }
    }

    private fun retry() {
        loadData()
        invalidate()
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun formatDuration(totalMin: Int): String {
        val h = totalMin / 60
        val m = totalMin % 60
        return if (h > 0) "${h}h ${m}m" else "${m}m"
    }
}
