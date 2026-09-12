package expo.modules.apkupdater

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * "Code UI 0.5.9 downloaded — tap to install." Posted by the download-complete
 * receiver, which may be running with no JS and no Activity, so it is plain
 * NotificationManager. Tapping launches the app; the update dialog then reads
 * the stored phase and offers Install.
 */
internal object UpdateNotifier {
  private const val CHANNEL = "app-updates"
  const val NOTIFICATION_ID = 7702

  fun downloaded(context: Context, version: String) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT).apply {
          description = "A new version of Code UI is downloaded and ready to install"
        }
      )
    }
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
    val tap = PendingIntent.getActivity(context, NOTIFICATION_ID, launch, flags)
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CHANNEL)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
    val notification = builder
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle("Code UI $version downloaded")
      .setContentText("Tap to install the update")
      .setContentIntent(tap)
      .setAutoCancel(true)
      .build()
    manager.notify(NOTIFICATION_ID, notification)
  }

  fun clear(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancel(NOTIFICATION_ID)
  }
}
