package app.letsjustdrive.auto.util

import app.letsjustdrive.auto.models.Station
import app.letsjustdrive.auto.models.StationOnRoute
import kotlin.math.*

/**
 * Filters a flat list of stations to those within [maxDistanceM] metres of a
 * route polyline, then sorts them by distance along the route.
 *
 * This mirrors the client-side corridor search in the web app
 * (app/src/services/corridorSearch.ts) so both clients produce consistent results.
 */
object CorridorFilter {

    fun filter(
        stations: List<Station>,
        path: List<Pair<Double, Double>>,
        maxDistanceM: Double = 3_000.0,
    ): List<StationOnRoute> {
        if (path.size < 2) return emptyList()

        return stations
            .mapNotNull { station ->
                val (distFromRoute, distAlong) = closestPoint(station.lat, station.lng, path)
                if (distFromRoute <= maxDistanceM) {
                    StationOnRoute(
                        station = station,
                        distanceAlongRouteMeters = distAlong.roundToInt(),
                        // Rough detour: perpendicular distance × 2 (go off-route and return)
                        detourMeters = (distFromRoute * 2).roundToInt(),
                    )
                } else null
            }
            .sortedBy { it.distanceAlongRouteMeters }
    }

    /**
     * Returns (perpendicularDistanceMetres, distanceAlongRouteMetres) for the
     * closest point on the polyline to the given lat/lng.
     */
    private fun closestPoint(
        lat: Double,
        lng: Double,
        path: List<Pair<Double, Double>>,
    ): Pair<Double, Double> {
        var minDist = Double.MAX_VALUE
        var bestDistAlong = 0.0
        var cumulativeDist = 0.0

        for (i in 0 until path.size - 1) {
            val (aLat, aLng) = path[i]
            val (bLat, bLng) = path[i + 1]
            val segLen = haversine(aLat, aLng, bLat, bLng)
            val (dist, t) = pointToSegment(lat, lng, aLat, aLng, bLat, bLng)
            if (dist < minDist) {
                minDist = dist
                bestDistAlong = cumulativeDist + t * segLen
            }
            cumulativeDist += segLen
        }

        return Pair(minDist, bestDistAlong)
    }

    // ── Geometry helpers ──────────────────────────────────────────────────────

    private fun haversine(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val R = 6_371_000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2).pow(2) +
                cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2).pow(2)
        return R * 2 * asin(sqrt(a))
    }

    /**
     * Returns (distanceMetres, t) where t ∈ [0,1] is the projection parameter
     * along segment A→B.
     */
    private fun pointToSegment(
        pLat: Double, pLng: Double,
        aLat: Double, aLng: Double,
        bLat: Double, bLng: Double,
    ): Pair<Double, Double> {
        // Flatten to metres using a local equirectangular approximation
        val cosLat = cos(Math.toRadians((pLat + aLat) / 2.0))
        val apX = (pLat - aLat) * 111_000.0
        val apY = (pLng - aLng) * 111_000.0 * cosLat
        val abX = (bLat - aLat) * 111_000.0
        val abY = (bLng - aLng) * 111_000.0 * cosLat
        val len2 = abX * abX + abY * abY
        if (len2 == 0.0) return Pair(sqrt(apX * apX + apY * apY), 0.0)

        val t = ((apX * abX + apY * abY) / len2).coerceIn(0.0, 1.0)
        val projLat = aLat + t * (bLat - aLat)
        val projLng = aLng + t * (bLng - aLng)
        return Pair(haversine(pLat, pLng, projLat, projLng), t)
    }
}
