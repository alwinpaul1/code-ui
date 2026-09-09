package expo.modules.backgroundlink

import android.content.Context
import android.content.Intent
import android.os.Build
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
  }
}
