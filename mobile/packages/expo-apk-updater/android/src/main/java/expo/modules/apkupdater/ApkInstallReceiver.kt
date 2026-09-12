package expo.modules.apkupdater

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller

/**
 * The PackageInstaller session result. On success the OS replaces the running
 * app and this process is torn down, so there is nothing to do but record it.
 * PENDING_USER_ACTION means the system still wants a tap (older Android, or a
 * mismatch that blocks the silent path); the confirmation Intent is held for a
 * foreground Activity to launch. Anything else is a failure with a message the
 * banner can show.
 */
class ApkInstallReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        @Suppress("DEPRECATION")
        val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
        ApkUpdaterModule.pendingUserActionIntent = confirm
        UpdaterStore.setPhase(context, UpdaterStore.PHASE_PENDING)
        ApkUpdaterModule.emitStatus(context)
      }
      PackageInstaller.STATUS_SUCCESS -> {
        UpdaterStore.setPhase(context, UpdaterStore.PHASE_IDLE)
        ApkUpdaterModule.emitStatus(context)
      }
      else -> {
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Install failed"
        UpdaterStore.setPhase(context, UpdaterStore.PHASE_FAILED, message)
        ApkUpdaterModule.emitStatus(context)
      }
    }
  }

  companion object {
    const val ACTION = "expo.modules.apkupdater.INSTALL_STATUS"
  }
}
