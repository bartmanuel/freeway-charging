package app.letsjustdrive.auto

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.core.content.ContextCompat
import app.letsjustdrive.auto.screens.PermissionScreen
import app.letsjustdrive.auto.screens.StartScreen

/**
 * One [Session] is created per Android Auto connection. It owns the
 * [androidx.car.app.ScreenManager] stack and decides which screen to show first.
 *
 * If location permission has already been granted on the phone we go straight to
 * [StartScreen]. Otherwise [PermissionScreen] requests it and then transitions
 * to [StartScreen] once the user taps Allow.
 */
class FreewaySession : Session() {

    override fun onCreateScreen(intent: Intent): Screen {
        val granted = ContextCompat.checkSelfPermission(
            carContext,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED

        return if (granted) StartScreen(carContext) else PermissionScreen(carContext)
    }
}
