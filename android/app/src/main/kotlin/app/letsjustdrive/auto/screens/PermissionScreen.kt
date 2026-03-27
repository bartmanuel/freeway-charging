package app.letsjustdrive.auto.screens

import android.Manifest
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template

/**
 * Shown when the app hasn't been granted location permission yet.
 *
 * [CarContext.requestPermissions] pops up a notification on the user's PHONE
 * asking them to tap Allow. Once they do, the callback pushes [StartScreen].
 *
 * If they deny, the message stays visible so they can retry.
 */
class PermissionScreen(carContext: CarContext) : Screen(carContext) {

    override fun onGetTemplate(): Template {
        return MessageTemplate.Builder(
            "Tap \u201cAllow\u201d on your phone to grant location access, " +
                    "then let\u2019s find charging stations along your route."
        )
            .setTitle("Location needed")
            .setHeaderAction(Action.APP_ICON)
            .addAction(
                androidx.car.app.model.Action.Builder()
                    .setTitle("Grant access")
                    .setOnClickListener { requestLocation() }
                    .build()
            )
            .build()
    }

    private fun requestLocation() {
        carContext.requestPermissions(
            listOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            )
        ) { granted, _ ->
            if (granted.contains(Manifest.permission.ACCESS_FINE_LOCATION) ||
                granted.contains(Manifest.permission.ACCESS_COARSE_LOCATION)
            ) {
                screenManager.push(StartScreen(carContext))
            } else {
                // Stay on this screen — user can tap the button again
                invalidate()
            }
        }
    }
}
