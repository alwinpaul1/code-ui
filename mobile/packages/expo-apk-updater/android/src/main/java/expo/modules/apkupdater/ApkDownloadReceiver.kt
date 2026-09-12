package expo.modules.apkupdater

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import java.io.File

/**
 * Fires when DownloadManager finishes a download — even if the app was swiped
 * away, because it is declared in the manifest. If the finished job is the one
 * we enqueued, it hands the file straight to the installer. That chain is what
 * makes "download in the background, install like a system update" hold with
 * the app closed: DownloadManager owns the transfer, this receiver owns the
 * handoff, and neither needs the JS runtime or an Activity.
 */
class ApkDownloadReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) {
      return
    }
    val finishedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
    val ours = UpdaterStore.downloadId(context)
    if (finishedId == -1L || finishedId != ours) {
      return
    }

    val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    val query = DownloadManager.Query().setFilterById(finishedId)
    manager.query(query)?.use { cursor ->
      if (!cursor.moveToFirst()) {
        UpdaterStore.setPhase(context, UpdaterStore.PHASE_FAILED, "Download vanished")
        return
      }
      val statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
      if (cursor.getInt(statusIndex) != DownloadManager.STATUS_SUCCESSFUL) {
        val reasonIndex = cursor.getColumnIndex(DownloadManager.COLUMN_REASON)
        UpdaterStore.setPhase(context, UpdaterStore.PHASE_FAILED, "Download failed (${cursor.getInt(reasonIndex)})")
        return
      }
      val localUriIndex = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)
      val localUri = cursor.getString(localUriIndex)
      val file = fileFromLocalUri(localUri) ?: UpdaterStore.file(context)?.let { File(it) }
      if (file == null || !file.isFile) {
        UpdaterStore.setPhase(context, UpdaterStore.PHASE_FAILED, "Downloaded file is missing")
        return
      }
      UpdaterStore.setPhase(context, UpdaterStore.PHASE_DOWNLOADED)
      ApkInstallSession.install(context, file)
    }
  }

  private fun fileFromLocalUri(localUri: String?): File? {
    if (localUri == null) {
      return null
    }
    val parsed = Uri.parse(localUri)
    val path = if (parsed.scheme == "file") parsed.path else localUri
    return path?.let { File(it) }
  }
}
