package expo.modules.apkupdater

import android.content.Context

/**
 * The small bit of state that must outlive the process: which DownloadManager
 * job is ours, where its file lands, and what phase the update is in. A cold
 * BroadcastReceiver (the app swiped away) reads this to know a completed
 * download belongs to us and to drive the install; the JS side reads it on
 * launch to restore the banner. Kept in SharedPreferences because the JS
 * runtime and any in-memory field are gone once the app is killed.
 */
internal object UpdaterStore {
  private const val PREFS = "codeui.apk-updater"
  private const val KEY_ID = "downloadId"
  private const val KEY_VERSION = "version"
  private const val KEY_FILE = "file"
  private const val KEY_PHASE = "phase"
  private const val KEY_MESSAGE = "message"

  // idle → downloading → downloaded → installing → (process restart on success)
  //                                             ↘ pending-user-action / failed
  const val PHASE_IDLE = "idle"
  const val PHASE_DOWNLOADING = "downloading"
  const val PHASE_DOWNLOADED = "downloaded"
  const val PHASE_INSTALLING = "installing"
  const val PHASE_PENDING = "pending-user-action"
  const val PHASE_FAILED = "failed"

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun setDownload(context: Context, id: Long, version: String, file: String) {
    prefs(context).edit()
      .putLong(KEY_ID, id)
      .putString(KEY_VERSION, version)
      .putString(KEY_FILE, file)
      .putString(KEY_PHASE, PHASE_DOWNLOADING)
      .remove(KEY_MESSAGE)
      .apply()
  }

  fun downloadId(context: Context): Long = prefs(context).getLong(KEY_ID, -1L)
  fun version(context: Context): String? = prefs(context).getString(KEY_VERSION, null)
  fun file(context: Context): String? = prefs(context).getString(KEY_FILE, null)
  fun phase(context: Context): String = prefs(context).getString(KEY_PHASE, PHASE_IDLE) ?: PHASE_IDLE
  fun message(context: Context): String? = prefs(context).getString(KEY_MESSAGE, null)

  fun setPhase(context: Context, phase: String, message: String? = null) {
    prefs(context).edit().putString(KEY_PHASE, phase).putString(KEY_MESSAGE, message).apply()
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
  }
}
