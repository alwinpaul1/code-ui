package expo.modules.backgroundlink

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

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
 *
 * Why it starts its task itself instead of through the base class: it has to
 * know which task is its own. HeadlessJsTaskContext tells every listener about
 * every headless task that finishes in the process, and expo-task-manager runs
 * one for each WorkManager run of the hourly update check. The base class keeps
 * its task ids private, so this service could not tell expo's finish from its
 * own. It treated expo's as its own and cleared `taskStarted`, and the next
 * open started a second link task. The two tasks ended each other and the
 * service stopped itself seconds after the app was opened (a Pixel on 0.9.54,
 * 2026-09-27: "background service not running" on every hourly wake overnight).
 */
class BackgroundLinkService : HeadlessJsTaskService() {
  private var taskStarted = false

  /** The id HeadlessJsTaskContext returned for this service's own task. */
  private var ownTaskId: Int? = null

  /** Why this run is ending, when the service itself knows. See [recordStop]. */
  private var stopCause: String? = null

  /** Swiped out of Recents during this run. */
  private var taskRemoved = false

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
    stopCause = null
    requestedStopCause = null
    taskRemoved = false
    recordStart(this)
    startOwnTask(getTaskConfig(intent))
    // What the base class returned for a started task: after a process death
    // Android restarts the service with this intent.
    return START_REDELIVER_INTENT
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(
      TASK_KEY,
      Arguments.createMap(),
      /* timeout: none — the task runs until JS stops the service */ 0,
      /* allowedInForeground */ true
    )

  /**
   * The base class's startTask, keeping the id. It takes the wake lock, then
   * runs the task on the current React context or on the one it starts. This
   * app is New Architecture only (newArchEnabled=true), so the context always
   * comes from the ReactHost, as it does in the base class's bridgeless branch.
   */
  private fun startOwnTask(config: HeadlessJsTaskConfig) {
    HeadlessJsTaskService.acquireWakeLockNow(this)
    val context = reactContext
    if (context != null) {
      runOwnTask(context, config)
      return
    }
    val host = checkNotNull(reactHost) { "ReactHost is not initialized in New Architecture" }
    host.addReactInstanceEventListener(
      object : ReactInstanceEventListener {
        override fun onReactContextInitialized(context: ReactContext) {
          host.removeReactInstanceEventListener(this)
          runOwnTask(context, config)
        }
      }
    )
    host.start()
  }

  private fun runOwnTask(context: ReactContext, config: HeadlessJsTaskConfig) {
    val tasks = HeadlessJsTaskContext.getInstance(context)
    tasks.addTaskEventListener(this)
    // startTask must run on the UI thread. The id is assigned in the same
    // runnable, and a finish is posted to the UI thread after it, so a finish
    // can never arrive before the id is known.
    UiThreadUtil.runOnUiThread {
      ownTaskId = tasks.startTask(config)
    }
  }

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    if (taskId != ownTaskId) {
      // Another module's headless task (expo-task-manager runs one for every
      // WorkManager job). It says nothing about this service's task, which
      // is still parked.
      return
    }
    // Not super: the base class's own task set is empty, because this service
    // starts its task itself, so its handler would stop the service on ANY
    // task's finish. Stopping here is what it would have done for this one.
    // The JS task only ends when delivery was switched off or the runtime
    // threw, and JS restarts the service on the next foreground.
    ownTaskId = null
    taskStarted = false
    stopCause = STOP_TASK_ENDED
    stopSelf()
  }

  /**
   * Android 15's foreground-service time limit. `remoteMessaging` has none
   * today, so this should never run. It is here so that if a future Android
   * adds one, the log names it instead of "Android stopped it". Android
   * requires a stopSelf() within seconds or it crashes the app.
   */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopCause = STOP_TIMEOUT
    stopSelf()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiped out of Recents: keep running. This is the whole point. Written
    // down now, not in onDestroy, because some OEMs kill the whole process
    // after a swipe, and a killed process never reaches onDestroy.
    taskRemoved = true
    recordTaskRemoved(this)
  }

  override fun onDestroy() {
    // Why a cause on every destroy: before this, a stopped service logged
    // nothing, and a night of "background service not running" never said
    // why. The service itself stops only for its own task ending or a
    // timeout, and JS says when it asked. Anything else is Android.
    // JS's request comes first: switching delivery off releases the task AND
    // stops the service, and the task's finish can land before this does.
    recordStop(this, requestedStopCause ?: stopCause ?: if (taskRemoved) STOP_TASK_REMOVED else STOP_EXTERNAL)
    requestedStopCause = null
    isRunning = false
    taskStarted = false
    ownTaskId = null
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

    // Stop causes, as JS reads them from [lastStop].
    const val STOP_TASK_ENDED = "task-ended"
    const val STOP_JS = "js-stop"
    const val STOP_TIMEOUT = "timeout"
    const val STOP_TASK_REMOVED = "task-removed"
    const val STOP_EXTERNAL = "external"

    private const val STOP_PREFS = "expo.modules.backgroundlink.stop"
    private const val KEY_STARTED_AT = "startedAt"
    private const val KEY_STOPPED_AT = "stoppedAt"
    private const val KEY_STOP_CAUSE = "stopCause"
    private const val KEY_TASK_REMOVED_AT = "taskRemovedAt"

    @Volatile
    var isRunning: Boolean = false
      internal set

    /** Set by the module just before it stops the service for JS. */
    @Volatile
    internal var requestedStopCause: String? = null

    private fun stopPrefs(context: Context) = context.getSharedPreferences(STOP_PREFS, Context.MODE_PRIVATE)

    private fun recordStart(context: Context) {
      stopPrefs(context).edit()
        .putLong(KEY_STARTED_AT, System.currentTimeMillis())
        .remove(KEY_TASK_REMOVED_AT)
        .apply()
    }

    // apply() is enough here: Android waits for pending preference writes
    // after a service's onDestroy before it lets the process go.
    private fun recordStop(context: Context, cause: String) {
      stopPrefs(context).edit()
        .putLong(KEY_STOPPED_AT, System.currentTimeMillis())
        .putString(KEY_STOP_CAUSE, cause)
        .apply()
    }

    // commit(), not apply(): nothing waits for this write if the process is
    // killed right after the swipe, which is the case it exists for.
    private fun recordTaskRemoved(context: Context) {
      stopPrefs(context).edit().putLong(KEY_TASK_REMOVED_AT, System.currentTimeMillis()).commit()
    }

    /**
     * When the last run started, when and why the last run stopped, and how
     * the app's process last ended. A process that is killed never reaches
     * onDestroy, so its stop is not in the preferences; ApplicationExitInfo
     * (Android 11+) is the only witness. JS decides which one applies.
     */
    fun lastStop(context: Context): Map<String, Any?> {
      val prefs = stopPrefs(context)
      val record = mutableMapOf<String, Any?>(
        "startedAt" to prefs.timeOrNull(KEY_STARTED_AT),
        "stoppedAt" to prefs.timeOrNull(KEY_STOPPED_AT),
        "cause" to prefs.getString(KEY_STOP_CAUSE, null),
        "taskRemovedAt" to prefs.timeOrNull(KEY_TASK_REMOVED_AT)
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val exit = try {
          manager.getHistoricalProcessExitReasons(context.packageName, 0, 1).firstOrNull()
        } catch (_: Exception) {
          null
        }
        if (exit != null) {
          record["exitAt"] = exit.timestamp.toDouble()
          record["exitReason"] = exit.reason
          record["exitDescription"] = exit.description
        }
      }
      return record
    }

    private fun SharedPreferences.timeOrNull(key: String): Double? =
      if (contains(key)) getLong(key, 0L).toDouble() else null

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
