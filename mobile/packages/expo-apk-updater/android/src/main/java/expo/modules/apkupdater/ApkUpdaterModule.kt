package expo.modules.apkupdater

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.content.Intent
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * JS-facing control of the background self-update.
 *
 * `startUpdate` enqueues a DownloadManager job — the system carries it, shows
 * its own progress notification, and finishes it even if the app is swiped
 * away. Completion is handled by [ApkDownloadReceiver], which installs without
 * needing this module or an Activity. While the app is on screen, a poller
 * turns DownloadManager's byte counts into `onProgress` events so the banner
 * shows a live bar; the download does not depend on the poller.
 */
class ApkUpdaterModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private var poller: Runnable? = null

  private fun context(): Context =
    appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun downloadManager(context: Context): DownloadManager =
    context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

  private fun safeName(version: String): String =
    "code-ui-" + version.replace(Regex("[^0-9A-Za-z.-]"), "_") + ".apk"

  private fun startUpdate(url: String, version: String) {
    val context = context()
    val fileName = safeName(version)
    // Why external files dir: app-private (no permission), yet a real file path
    // the PackageInstaller session can read. DownloadManager cleans a stale
    // one on re-enqueue.
    val destDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
    val destFile = File(destDir, fileName)
    if (destFile.exists()) {
      destFile.delete()
    }
    val request = DownloadManager.Request(Uri.parse(url))
      .setTitle("Code UI $version")
      .setDescription("Downloading update")
      // Why not NOTIFY_COMPLETED: that leaves a "download complete" row whose
      // tap opens Android's manual installer. Progress only; our own
      // "downloaded, tap to install" notification takes over at the end.
      .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
      .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, fileName)
      .setMimeType(APK_MIME)
    val id = downloadManager(context).enqueue(request)
    UpdaterStore.setDownload(context, id, version, destFile.absolutePath)
    startPolling()
  }

  private fun startPolling() {
    stopPolling()
    val runnable = object : Runnable {
      override fun run() {
        val context = appContext.reactContext ?: return
        if (UpdaterStore.phase(context) != UpdaterStore.PHASE_DOWNLOADING) {
          emitStatusEvent(context)
          return
        }
        val (downloaded, total) = queryProgress(context)
        if (total > 0) {
          sendEvent("onProgress", mapOf("progress" to (downloaded.toDouble() / total.toDouble())))
        }
        handler.postDelayed(this, 700)
      }
    }
    poller = runnable
    handler.post(runnable)
  }

  private fun stopPolling() {
    poller?.let { handler.removeCallbacks(it) }
    poller = null
  }

  private fun queryProgress(context: Context): Pair<Long, Long> {
    val id = UpdaterStore.downloadId(context)
    if (id < 0) {
      return 0L to 0L
    }
    downloadManager(context).query(DownloadManager.Query().setFilterById(id))?.use { cursor ->
      if (!cursor.moveToFirst()) {
        return 0L to 0L
      }
      val soFar = cursor.getLong(cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
      val total = cursor.getLong(cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
      return soFar to total
    }
    return 0L to 0L
  }

  private fun emitStatusEvent(context: Context) {
    sendEvent("onStatus", stateMap(context))
  }

  override fun definition() = ModuleDefinition {
    Name("ApkUpdater")

    Events("onProgress", "onStatus")

    OnCreate {
      instance = this@ApkUpdaterModule
      // A download that finished while the app was gone leaves the phase at
      // downloaded/installing/pending; a live one resumes the progress bar.
      appContext.reactContext?.let { context ->
        if (UpdaterStore.phase(context) == UpdaterStore.PHASE_DOWNLOADING) {
          startPolling()
        }
      }
    }

    OnDestroy {
      stopPolling()
      if (instance === this@ApkUpdaterModule) {
        instance = null
      }
    }

    Function("isSilentUpdateSupported") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    }

    Function("getState") {
      stateMap(context())
    }

    AsyncFunction("startUpdate") { url: String, version: String, promise: Promise ->
      try {
        startUpdate(url, version)
        promise.resolve(stateMap(context()))
      } catch (error: Exception) {
        UpdaterStore.setPhase(context(), UpdaterStore.PHASE_FAILED, error.message ?: error.toString())
        promise.resolve(stateMap(context()))
      }
    }

    Function("install") {
      val context = context()
      val path = UpdaterStore.file(context) ?: return@Function false
      UpdateNotifier.clear(context)
      ApkInstallSession.install(context, File(path))
    }

    Function("hasPendingUserAction") {
      pendingUserActionIntent != null
    }

    Function("launchPendingUserAction") {
      val intent = pendingUserActionIntent ?: return@Function false
      pendingUserActionIntent = null
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context().startActivity(intent)
        true
      } catch (error: Exception) {
        false
      }
    }

    Function("clear") {
      val context = context()
      // Why sweep the folder: a successful install clears the stored path
      // before the JS side ever runs, so the file it named is unknown by the
      // next launch — and an older build's leftover has a different name
      // anyway (code-ui-0.5.8.apk found beside a fresh 0.5.12).
      context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
        ?.listFiles { file -> file.name.startsWith("code-ui-") && file.name.endsWith(".apk") }
        ?.forEach { it.delete() }
      UpdateNotifier.clear(context)
      UpdaterStore.clear(context)
    }
  }

  private fun stateMap(context: Context): Map<String, Any?> = mapOf(
    "phase" to UpdaterStore.phase(context),
    "version" to UpdaterStore.version(context),
    "message" to UpdaterStore.message(context),
    "pendingUserAction" to (pendingUserActionIntent != null)
  )

  companion object {
    private const val APK_MIME = "application/vnd.android.package-archive"

    @Volatile
    private var instance: ApkUpdaterModule? = null

    /** The confirmation the system asked for, valid only in this process. */
    @Volatile
    var pendingUserActionIntent: Intent? = null

    /** Called from the receivers; forwards a status event when the module is
     *  alive, and is a no-op (state is already in the store) when it is not. */
    fun emitStatus(context: Context) {
      instance?.emitStatusEvent(context)
    }
  }
}
