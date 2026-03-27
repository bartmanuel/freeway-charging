package app.letsjustdrive.auto.api

import app.letsjustdrive.auto.BuildConfig
import app.letsjustdrive.auto.models.PlaceSuggestion
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URLEncoder

/**
 * Wraps the Google Places Autocomplete API to power the [SearchTemplate] suggestions.
 *
 * Uses the legacy "Places API" (autocomplete/json) endpoint which is available on
 * the same key as the Maps JavaScript API used by the web app.
 *
 * Ensure the "Places API" is enabled in your Google Cloud project.
 */
object GooglePlacesClient {

    private val http = OkHttpClient()

    /**
     * Returns up to 5 autocomplete suggestions for [query].
     *
     * @param bias Optional location bias in the format "circle:radiusMetres@lat,lng".
     *             Pass the user's current location to rank nearby results higher.
     */
    suspend fun autocomplete(
        query: String,
        bias: String? = null,
    ): List<PlaceSuggestion> = withContext(Dispatchers.IO) {
        if (query.isBlank()) return@withContext emptyList()

        val encoded = URLEncoder.encode(query, "UTF-8")
        val biasParam = if (bias != null) "&locationbias=${URLEncoder.encode(bias, "UTF-8")}" else ""
        val url = "https://maps.googleapis.com/maps/api/place/autocomplete/json" +
                "?input=$encoded" +
                "&types=geocode|establishment" +
                "&language=en" +
                "&key=${BuildConfig.GOOGLE_MAPS_API_KEY}" +
                biasParam

        val req = Request.Builder().url(url).build()
        val responseText = http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return@withContext emptyList()
            resp.body?.string() ?: return@withContext emptyList()
        }

        val root = JSONObject(responseText)
        if (root.optString("status") != "OK") return@withContext emptyList()

        val predictions = root.getJSONArray("predictions")
        (0 until predictions.length()).map { i ->
            val p = predictions.getJSONObject(i)
            val fmt = p.getJSONObject("structured_formatting")
            PlaceSuggestion(
                placeId = p.getString("place_id"),
                mainText = fmt.getString("main_text"),
                secondaryText = fmt.optString("secondary_text", ""),
                fullAddress = p.getString("description"),
            )
        }
    }
}
