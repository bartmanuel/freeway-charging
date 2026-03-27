package app.letsjustdrive.auto.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.*
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import app.letsjustdrive.auto.api.GooglePlacesClient
import app.letsjustdrive.auto.models.PlaceSuggestion
import app.letsjustdrive.auto.util.LocationUtils
import kotlinx.coroutines.*

/**
 * First screen the user sees: a [SearchTemplate] with a voice-search button and
 * live Places Autocomplete suggestions as they type.
 *
 * Flow:
 *  1. User speaks/types a destination.
 *  2. Suggestions are fetched from Google Places (debounced 400 ms).
 *  3. Tapping a suggestion pushes [StationListScreen], which loads the route and
 *     stations asynchronously while showing a loading indicator.
 */
class StartScreen(carContext: CarContext) : Screen(carContext) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var searchJob: Job? = null

    private var suggestions: List<PlaceSuggestion> = emptyList()
    private var isSearching = false

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) = scope.cancel()
        })
    }

    // ── Template ──────────────────────────────────────────────────────────────

    override fun onGetTemplate(): Template {
        val listBuilder = ItemList.Builder()

        when {
            isSearching -> listBuilder.setNoItemsMessage("Searching\u2026")
            suggestions.isNotEmpty() -> {
                // Car App Library caps list items at 6 in SearchTemplate
                suggestions.take(6).forEach { suggestion ->
                    listBuilder.addItem(
                        Row.Builder()
                            .setTitle(suggestion.mainText)
                            .addText(suggestion.secondaryText)
                            .setOnClickListener { onSuggestionSelected(suggestion) }
                            .build()
                    )
                }
            }
            else -> listBuilder.setNoItemsMessage("Say or type your destination")
        }

        return SearchTemplate.Builder(searchCallback)
            .setHeaderAction(Action.APP_ICON)
            // showKeyboardByDefault=false is the safe default for driving.
            // The microphone button is always visible for voice input.
            .setShowKeyboardByDefault(false)
            .setItemList(listBuilder.build())
            .build()
    }

    // ── Search callback ───────────────────────────────────────────────────────

    private val searchCallback = object : SearchTemplate.SearchCallback {

        override fun onSearchTextChanged(searchText: String) {
            onSearch(searchText)
        }

        override fun onSearchSubmitted(searchText: String) {
            // If the user hits Enter/Done and there are suggestions, take the first one
            if (suggestions.isNotEmpty()) onSuggestionSelected(suggestions.first())
        }
    }

    private fun onSearch(text: String) {
        searchJob?.cancel()
        if (text.length < 2) {
            suggestions = emptyList()
            isSearching = false
            invalidate()
            return
        }
        isSearching = true
        invalidate()

        searchJob = scope.launch {
            delay(400) // debounce — don't spam Places API on every keystroke

            // Bias results toward the user's current location
            val location = withContext(Dispatchers.IO) {
                LocationUtils.getLastKnownLocation(carContext)
            }
            val bias = location?.let { "circle:100000@${it.latitude},${it.longitude}" }

            suggestions = GooglePlacesClient.autocomplete(text, bias)
            isSearching = false
            invalidate()
        }
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    private fun onSuggestionSelected(suggestion: PlaceSuggestion) {
        screenManager.push(StationListScreen(carContext, suggestion))
    }
}
