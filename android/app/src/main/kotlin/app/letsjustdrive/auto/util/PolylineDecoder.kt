package app.letsjustdrive.auto.util

/**
 * Decodes a Google Encoded Polyline string into a list of (lat, lng) pairs.
 *
 * Algorithm: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
object PolylineDecoder {

    fun decode(encoded: String): List<Pair<Double, Double>> {
        val result = mutableListOf<Pair<Double, Double>>()
        var index = 0
        var lat = 0
        var lng = 0

        while (index < encoded.length) {
            lat += decodeDelta(encoded, index).also { index += it.second }.first
            lng += decodeDelta(encoded, index).also { index += it.second }.first
            result.add(Pair(lat / 1e5, lng / 1e5))
        }

        return result
    }

    /** Returns (delta value, characters consumed). */
    private fun decodeDelta(encoded: String, startIndex: Int): Pair<Int, Int> {
        var shift = 0
        var value = 0
        var i = startIndex
        var b: Int
        do {
            b = encoded[i++].code - 63
            value = value or ((b and 0x1f) shl shift)
            shift += 5
        } while (b >= 0x20)
        val delta = if (value and 1 != 0) -(value shr 1) else (value shr 1)
        return Pair(delta, i - startIndex)
    }
}
