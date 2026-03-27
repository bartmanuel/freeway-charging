package app.letsjustdrive.auto.api

import app.letsjustdrive.auto.BuildConfig
import app.letsjustdrive.auto.models.Route
import app.letsjustdrive.auto.models.Station
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * HTTP client for the Cloudflare Workers backend.
 *
 * Endpoints used:
 *   POST /api/route              — proxies Google Routes API v2, returns encoded polyline
 *   POST /api/stations/corridor  — bbox query into Supabase (NDW) with OCM fallback
 */
object ApiClient {

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    private val BASE = BuildConfig.WORKER_BASE_URL

    // ── Route ─────────────────────────────────────────────────────────────────

    /**
     * Fetches a driving route.
     *
     * @param origin      "lat,lng" string from the device GPS
     * @param destination Free-text address or place name (resolved server-side)
     */
    suspend fun fetchRoute(origin: String, destination: String): Route =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("origin", origin)
                .put("destination", destination)
                .toString()
                .toRequestBody(JSON_MEDIA)

            val req = Request.Builder()
                .url("$BASE/api/route")
                .post(body)
                .build()

            val responseText = http.newCall(req).execute().use { resp ->
                check(resp.isSuccessful) {
                    "Route API returned ${resp.code}: ${resp.body?.string()}"
                }
                resp.body!!.string()
            }

            // The worker returns the raw Google Routes API v2 response:
            // { "routes": [{ "distanceMeters": N, "duration": "Xs",
            //                "polyline": { "encodedPolyline": "..." } }] }
            val route = JSONObject(responseText)
                .getJSONArray("routes")
                .getJSONObject(0)

            Route(
                encodedPolyline = route
                    .getJSONObject("polyline")
                    .getString("encodedPolyline"),
                distanceMeters = route.getInt("distanceMeters"),
                // duration is "1234s" — strip the trailing 's'
                durationSeconds = route.getString("duration").trimEnd('s').toInt(),
            )
        }

    // ── Stations ──────────────────────────────────────────────────────────────

    /**
     * Fetches charging stations within the given bounding box.
     *
     * The caller should add ~0.05° padding to each side of the polyline's own
     * bounding box so stations just off the route edge aren't missed before the
     * client-side corridor filter runs.
     *
     * @param encodedPolyline Passed to the worker so it can forward to OCM's
     *                        polyline= parameter if Supabase returns < 3 results.
     */
    suspend fun fetchStations(
        minLat: Double,
        maxLat: Double,
        minLng: Double,
        maxLng: Double,
        encodedPolyline: String,
        minPowerKw: Int = 50,
    ): List<Station> = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("minLat", minLat)
            .put("maxLat", maxLat)
            .put("minLng", minLng)
            .put("maxLng", maxLng)
            .put("minPowerKw", minPowerKw)
            .put("encodedPolyline", encodedPolyline)
            .toString()
            .toRequestBody(JSON_MEDIA)

        val req = Request.Builder()
            .url("$BASE/api/stations/corridor")
            .post(body)
            .build()

        val responseText = http.newCall(req).execute().use { resp ->
            check(resp.isSuccessful) {
                "Corridor API returned ${resp.code}: ${resp.body?.string()}"
            }
            resp.body!!.string()
        }

        // Response is a flat JSON array of station objects
        val arr = JSONArray(responseText)
        (0 until arr.length()).map { i ->
            val s = arr.getJSONObject(i)
            Station(
                id = s.getString("id"),
                name = s.getString("name"),
                operator = s.optString("operator").takeIf { it.isNotBlank() },
                lat = s.getDouble("lat"),
                lng = s.getDouble("lng"),
                maxPowerKw = s.optInt("maxPowerKw", 50),
                totalStalls = s.optInt("totalStalls", 0).takeIf { it > 0 },
            )
        }
    }
}
