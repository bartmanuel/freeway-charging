package app.letsjustdrive.auto.models

/** A Google Places autocomplete suggestion. */
data class PlaceSuggestion(
    val placeId: String,
    val mainText: String,
    val secondaryText: String,
    /** Full "City, Country" string — passed as destination to the route API. */
    val fullAddress: String,
)

/** Decoded route returned by the Cloudflare Workers /api/route endpoint. */
data class Route(
    val encodedPolyline: String,
    val distanceMeters: Int,
    val durationSeconds: Int,
)

/** A charging station as returned by /api/stations/corridor. */
data class Station(
    val id: String,
    val name: String,
    val operator: String?,
    val lat: Double,
    val lng: Double,
    val maxPowerKw: Int,
    val totalStalls: Int?,
)

/** A station enriched with route-relative distances (computed client-side). */
data class StationOnRoute(
    val station: Station,
    /** Metres from the route origin to the closest point on the polyline. */
    val distanceAlongRouteMeters: Int,
    /** Rough round-trip detour estimate in metres (2 × perpendicular distance). */
    val detourMeters: Int,
)
