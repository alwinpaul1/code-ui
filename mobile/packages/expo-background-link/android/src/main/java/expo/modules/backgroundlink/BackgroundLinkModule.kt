package expo.modules.backgroundlink

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS-facing control of [BackgroundLinkService].
 *
 * `start` must be called while the app is in the foreground: Android 12+
 * refuses foreground-service starts from the background, so the JS side
 * starts the service on launch / on toggle and leaves it running.
 */
class BackgroundLinkModule : Module() {
  private fun requireContext(): Context =
    appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun startService(title: String, text: String) {
    val context = requireContext()
    val intent = Intent(context, BackgroundLinkService::class.java)
    intent.action = BackgroundLinkService.ACTION_START
    intent.putExtra(BackgroundLinkService.EXTRA_TITLE, title)
    intent.putExtra(BackgroundLinkService.EXTRA_TEXT, text)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(intent)
    } else {
      context.startService(intent)
    }
  }

  private fun stopService() {
    val context = requireContext()
    context.stopService(Intent(context, BackgroundLinkService::class.java))
  }

  /**
   * Doze suspends the app's network and ignores its wake locks — a foreground
   * service does not exempt it — so with the phone idle the background link's
   * socket goes silent until a maintenance window or the next screen-on.
   * That is "notifications arrive when I open the app". Only the battery
   * optimisation exemption (the "Unrestricted" battery setting) lifts it.
   */
  private fun isIgnoringBatteryOptimizations(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
    val context = requireContext()
    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return power.isIgnoringBatteryOptimizations(context.packageName)
  }

  /** Shows the system "Let app always run in background?" dialog. Returns false
   *  when no activity could take the intent (some OEM builds). */
  private fun requestIgnoreBatteryOptimizations(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
    val context = requireContext()
    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
    intent.data = Uri.parse("package:" + context.packageName)
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
      context.startActivity(intent)
      true
    } catch (error: Exception) {
      openBatteryOptimizationSettings()
    }
  }

  /** The system list of optimised apps, for builds that refuse the direct dialog. */
  private fun openBatteryOptimizationSettings(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
    val context = requireContext()
    val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
      context.startActivity(intent)
      true
    } catch (error: Exception) {
      false
    }
  }

  private fun updateService(title: String, text: String) {
    if (BackgroundLinkService.isRunning) {
      BackgroundLinkService.updateNotification(requireContext(), title, text)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("BackgroundLink")

    Function("start") { title: String, text: String ->
      startService(title, text)
    }

    Function("update") { title: String, text: String ->
      updateService(title, text)
    }

    Function("stop") {
      stopService()
    }

    Function("isRunning") {
      BackgroundLinkService.isRunning
    }

    Function("isIgnoringBatteryOptimizations") {
      isIgnoringBatteryOptimizations()
    }

    Function("requestIgnoreBatteryOptimizations") {
      requestIgnoreBatteryOptimizations()
    }
  }
}
