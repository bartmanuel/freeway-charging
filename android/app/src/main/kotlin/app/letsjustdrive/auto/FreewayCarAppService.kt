package app.letsjustdrive.auto

import androidx.car.app.CarAppService
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

/**
 * Entry point for the Android Auto interface.
 *
 * Android Auto discovers this service via the intent-filter in AndroidManifest.xml.
 * The host (Android Auto on the car screen) calls [onCreateSession] once per
 * connection to get the root [Session], which in turn creates the first [Screen].
 *
 * Host validation: [HostValidator.ALLOW_ALL_HOSTS_VALIDATOR] is used so you can
 * sideload and test the APK without a signed release. Before submitting to the
 * Play Store, switch to a proper allowlist:
 *
 *   override fun createHostValidator() = HostValidator.Builder(applicationContext)
 *       .addAllowedHosts(R.array.hosts_allowlist)
 *       .build()
 *
 * where R.array.hosts_allowlist contains the SHA256 fingerprints from
 * https://developer.android.com/training/cars/apps#verify-host
 */
class FreewayCarAppService : CarAppService() {

    override fun createHostValidator(): HostValidator =
        HostValidator.ALLOW_ALL_HOSTS_VALIDATOR

    override fun onCreateSession(): Session = FreewaySession()
}
