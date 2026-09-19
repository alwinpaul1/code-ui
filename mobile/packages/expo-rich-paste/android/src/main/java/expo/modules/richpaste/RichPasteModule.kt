package expo.modules.richpaste

import android.content.ClipData
import android.content.Context
import android.net.Uri
import android.util.Log
import android.view.View
import android.widget.EditText
import androidx.core.view.ContentInfoCompat
import androidx.core.view.OnReceiveContentListener
import androidx.core.view.ViewCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

/**
 * Lets a React Native TextInput take an image the way the Claude app's
 * composer does: from the keyboard's clipboard panel (Samsung, Gboard), from
 * the paste menu, or from a drag.
 *
 * React Native's EditText never declares `EditorInfo.contentMimeTypes`, so a
 * keyboard has nowhere to put an image and the tap does nothing (2026-09-19,
 * screenshot of the Samsung clipboard panel over the composer). AppCompat's
 * `ViewCompat.setOnReceiveContentListener` fixes both halves at once: the
 * EditText advertises the MIME types in `onCreateInputConnection` (ReactEditText
 * calls through to AppCompatEditText, which wraps the connection), and the
 * listener receives the content, whichever way it arrived.
 *
 * The listener copies each image out of its content URI at once — an IME grants
 * the URI only for the duration of the commit — into the app cache, and hands
 * the file to JS as an event. Text items are handed back to the view so a plain
 * paste keeps working.
 */
class RichPasteModule : Module() {
  private val attached = HashSet<Int>()

  private fun requireContext(): Context =
    appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun copyToCache(context: Context, uri: Uri): File? {
    val resolver = context.contentResolver
    val type = resolver.getType(uri) ?: "image/png"
    val extension = when {
      type.contains("jpeg") || type.contains("jpg") -> "jpg"
      type.contains("gif") -> "gif"
      type.contains("webp") -> "webp"
      else -> "png"
    }
    val dir = File(context.cacheDir, "rich-paste").apply { mkdirs() }
    prune(dir)
    val target = File(dir, "paste-${System.currentTimeMillis()}-${uri.hashCode()}.$extension")
    return try {
      resolver.openInputStream(uri)?.use { input ->
        FileOutputStream(target).use { output -> input.copyTo(output) }
      } ?: return null
      target
    } catch (error: Exception) {
      Log.w(TAG, "could not copy pasted image", error)
      target.delete()
      null
    }
  }

  /** Pasted copies older than a day: the upload read them minutes after. */
  private fun prune(dir: File) {
    val cutoff = System.currentTimeMillis() - 24L * 60 * 60 * 1000
    dir.listFiles()?.forEach { file ->
      if (file.isFile && file.lastModified() < cutoff) file.delete()
    }
  }

  private fun listenerFor(viewTag: Int): OnReceiveContentListener =
    OnReceiveContentListener { _: View, payload: ContentInfoCompat ->
      // android.util.Pair: what ContentInfoCompat.partition returns.
      val split = payload.partition { item: ClipData.Item -> item.uri != null }
      val withUris: ContentInfoCompat? = split.first
      val remainder: ContentInfoCompat? = split.second
      if (withUris != null) {
        val context = requireContext()
        val clip = withUris.clip
        for (index in 0 until clip.itemCount) {
          val uri = clip.getItemAt(index).uri ?: continue
          val type = context.contentResolver.getType(uri) ?: ""
          if (!type.startsWith("image/")) continue
          val file = copyToCache(context, uri) ?: continue
          sendEvent(
            EVENT_IMAGE,
            mapOf("viewTag" to viewTag, "uri" to Uri.fromFile(file).toString(), "mimeType" to type)
          )
        }
      }
      // Anything without a URI (typed or pasted text) goes on to the view.
      remainder
    }

  /** The view for a tag, or null when the mount has not produced it (yet).
   *  Fabric throws IllegalViewOperationException for a tag it does not hold,
   *  and that exception once left here as a rejected call and took the chat
   *  screen down (device, 2026-09-19). Missing is an answer, not an error. */
  private fun findViewOrNull(viewTag: Int): View? =
    try {
      appContext.findView<View>(viewTag)
    } catch (error: Exception) {
      Log.d(TAG, "no view for tag $viewTag yet: ${error.message}")
      null
    }

  private fun attach(viewTag: Int): Boolean {
    val view = findViewOrNull(viewTag)
    if (view !is EditText) return false
    if (attached.add(viewTag)) {
      ViewCompat.setOnReceiveContentListener(view, MIME_TYPES, listenerFor(viewTag))
    }
    return true
  }

  private fun detach(viewTag: Int) {
    attached.remove(viewTag)
    val view = findViewOrNull(viewTag) ?: return
    ViewCompat.setOnReceiveContentListener(view, null, null)
  }

  override fun definition() = ModuleDefinition {
    Name("RichPaste")
    Events(EVENT_IMAGE)

    // No labelled returns inside these bodies: the DSL's Function is inline
    // with a reified type, and a `return@Function` made the compiler emit a
    // real call to it, which throws at module registration and takes the app
    // down on launch (seen on the device, 2026-09-19).

    /** Declare image MIME types on the TextInput with this tag and start
     *  receiving. Idempotent per view; the listener is dropped with the view.
     *  On the main queue: Fabric mounts there after the JS commit, so a
     *  lookup from the JS thread can run before the view exists, and the
     *  view's listener must be set on the UI thread anyway. */
    AsyncFunction("attach") { viewTag: Int -> attach(viewTag) }.runOnQueue(Queues.MAIN)

    AsyncFunction("detach") { viewTag: Int -> detach(viewTag) }.runOnQueue(Queues.MAIN)
  }

  companion object {
    private const val TAG = "RichPaste"
    private const val EVENT_IMAGE = "onImage"
    private val MIME_TYPES = arrayOf("image/*")
  }
}
