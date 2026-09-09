package expo.modules.backgroundlink

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Foreground service that keeps the React Native runtime — and with it the
 * phone's encrypted socket to the desktop — alive while no Activity is on
 * screen, including after the user swipes the app out of Recents
 * (`stopWithTask="false"`).
 *
 * It is a [HeadlessJsTaskService] rather than a plain Service because React
 * Native pauses every JS timer when the host Activity pauses; only an active
 * headless task makes the timer manager keep firing. Without that the socket
 * would stay open but keepalive pings, request timeouts and reconnects would
 * all freeze until the app came back to the foreground.
 *
 * The task itself (`CodeUIBackgroundLink`, registered in JS) never resolves
 * while background delivery is enabled; the service ends when JS calls `stop`.
 */
class BackgroundLinkService : HeadlessJsTaskService() {
  private var taskStarted = false

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: DEFAULT_TITLE
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: DEFAULT_TEXT
    ensureChannel(this)
    val notification = buildNotification(this, title, text)
    // Why: startForeground must happen within seconds of startForegroundService(),
    // and before any of the headless plumbing, or Android kills the process with
    // a ForegroundServiceDidNotStartInTimeException.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    isRunning = true
    if (taskStarted) {
      // A second start only refreshes the notification text.
      return START_STICKY
    }
    taskStarted = true
    return super.onStartCommand(intent, flags, startId)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(
      TASK_KEY,
      Arguments.createMap(),
      /* timeout: none — the task runs until JS stops the service */ 0,
      /* allowedInForeground */ true
    )

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    // The base class stops the service once no task is active. That is the
    // right outcome: the JS task only ends when delivery was switched off or
    // the runtime threw, and JS restarts the service on the next foreground.
    taskStarted = false
    super.onHeadlessJsTaskFinish(taskId)
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiped out of Recents: keep running. This is the whole point.
  }

  override fun onDestroy() {
    isRunning = false
    taskStarted = false
    super.onDestroy()
  }

  companion object {
    const val ACTION_START = "expo.modules.backgroundlink.START"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val TASK_KEY = "CodeUIBackgroundLink"
    private const val CHANNEL_ID = "background-link"
    private const val NOTIFICATION_ID = 0x4C494E4B // "LINK"
    private const val DEFAULT_TITLE = "Code UI"
    private const val DEFAULT_TEXT = "Connected to your desktop"

    @Volatile
    var isRunning: Boolean = false
      internal set

    fun updateNotification(context: Context, title: String, text: String) {
      ensureChannel(context)
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(NOTIFICATION_ID, buildNotification(context, title, text))
    }

    private fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) != null) return
      // Why LOW: a persistent status row must never buzz or make a sound; the
      // agent notifications themselves ride the app's own high-importance channel.
      val channel = NotificationChannel(CHANNEL_ID, "Background link", NotificationManager.IMPORTANCE_LOW)
      channel.description = "Keeps the connection to your desktop alive so agent notifications arrive while the app is closed."
      channel.setShowBadge(false)
      manager.createNotificationChannel(channel)
    }

    private fun buildNotification(context: Context, title: String, text: String): Notification {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      val tap = launch?.let { PendingIntent.getActivity(context, 0, it, flags) }
      // Prefer the app's own notification glyph (written by expo-notifications'
      // config plugin); fall back to the launcher icon so the row always renders.
      val glyph = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
      val icon = if (glyph != 0) glyph else context.applicationInfo.icon
      return NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(icon)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setSilent(true)
        .setShowWhen(false)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setVisibility(NotificationCompat.VISIBILITY_SECRET)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .apply { if (tap != null) setContentIntent(tap) }
        .build()
    }
  }
}
