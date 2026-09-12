package expo.modules.apkupdater

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import java.io.File

/**
 * Commit a PackageInstaller session for a downloaded APK. Shared by the module
 * (a foreground "install now" tap) and the download-complete receiver (the
 * app may be dead). Neither needs an Activity: on Android 12+ a same-key
 * self-update marked USER_ACTION_NOT_REQUIRED installs silently, and the
 * result — success, a confirmation the system still wants, or a failure —
 * comes back through ApkInstallReceiver.
 */
internal object ApkInstallSession {
  fun install(context: Context, file: File): Boolean {
    if (!file.isFile) {
      UpdaterStore.setPhase(context, UpdaterStore.PHASE_FAILED, "Downloaded file is missing")
      return false
    }
    return try {
      UpdaterStore.setPhase(context, UpdaterStore.PHASE_INSTALLING)
      val installer = context.packageManager.packageInstaller
      val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
      params.setAppPackageName(context.packageName)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
      }
      val sessionId = installer.createSession(params)
      installer.openSession(sessionId).use { session ->
        session.openWrite("code-ui.apk", 0, file.length()).use { out ->
          file.inputStream().use { input -> input.copyTo(out) }
          session.fsync(out)
        }
        val intent = Intent(context, ApkInstallReceiver::class.java)
          .setAction(ApkInstallReceiver.ACTION)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
          (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
        val status = PendingIntent.getBroadcast(context, sessionId, intent, flags)
        session.commit(status.intentSender)
      }
      true
    } catch (error: Exception) {
      UpdaterStore.setPhase(context, UpdaterStore.PHASE_FAILED, error.message ?: error.toString())
      false
    }
  }
}
