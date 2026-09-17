package expo.modules.backgroundlink

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Starts the link again after the phone reboots or the app is replaced.
 *
 * Why this exists: nothing else did it. The service returns START_STICKY, but
 * Android does not honour that after a force-stop — which is exactly what an
 * aggressive OEM battery manager does — and a reboot clears the process
 * outright. So the link stayed down until somebody opened the app, and the
 * reported symptom was "notifications only work when the app is open".
 *
 * Why it is safe to start unconditionally: the headless task this service runs
 * calls `syncBackgroundLinkFromPreferences()` as its first act and returns when
 * background delivery is switched off, which lets the service stop itself and
 * releases the wake lock. So a boot start on a phone whose owner turned the
 * feature off costs one short task, not a running service.
 *
 * Why MY_PACKAGE_REPLACED as well as boot: an update kills the process, and the
 * user is not necessarily going to open the app afterwards — the in-app updater
 * installs in the background, so the most likely moment for the link to die
 * silently is right after it succeeds.
 *
 * Android 15+ forbids starting some foreground-service types from
 * BOOT_COMPLETED. `remoteMessaging`, which this service declares, is not one of
 * them. That is from the platform documentation and has NOT been confirmed on a
 * device here; if a future Android adds the type to that list, the start throws
 * and is swallowed below, so the failure mode is the behaviour we already had.
 */
class BackgroundLinkBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    when (intent?.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_LOCKED_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED -> Unit
      else -> return
    }
    val service = Intent(context, BackgroundLinkService::class.java)
    service.action = BackgroundLinkService.ACTION_START
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(service)
      } else {
        context.startService(service)
      }
    } catch (_: Throwable) {
      // A background foreground-service start can be refused — most often when
      // the user has not granted the battery-optimisation exemption. Throwing
      // from a receiver would crash the app on boot, and the link is restored
      // the next time the app is opened, which is what happened before this
      // receiver existed.
    }
  }
}
