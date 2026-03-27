package app.letsjustdrive.auto.util

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationManager

object LocationUtils {

    /**
     * Returns the most recent cached location from GPS or network providers,
     * or null if no fix is available or permissions were not granted.
     *
     * The Car App Library cannot request permissions mid-flow; the permission
     * check is done in [app.letsjustdrive.auto.FreewaySession] before any
     * screen that calls this utility is created.
     */
    @SuppressLint("MissingPermission")
    fun getLastKnownLocation(context: Context): Location? {
        return try {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
                .filter { provider ->
                    try { lm.isProviderEnabled(provider) } catch (_: Exception) { false }
                }
                .mapNotNull { provider ->
                    try { lm.getLastKnownLocation(provider) } catch (_: Exception) { null }
                }
                .maxByOrNull { it.time } // prefer the freshest fix
        } catch (_: Exception) {
            null
        }
    }
}
