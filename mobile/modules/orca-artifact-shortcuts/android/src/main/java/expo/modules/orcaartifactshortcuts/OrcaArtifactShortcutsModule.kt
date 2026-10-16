package expo.modules.orcaartifactshortcuts

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * "Add to home screen" for a claude.ai artifact: a pinned launcher shortcut that opens it in the
 * app's own viewer. mobile/src/session/claude-artifact-shortcut.ts calls it; it is Android only.
 *
 * The Claude Android app 1.261013.20 does the same with ShortcutManager.requestPinShortcut
 * (m2d.java:1466-1505): id `artifact_page_{accountId}_{orgId}_{artifactId}`, both labels the
 * artifact's title, intent VIEW to its ArtifactAppActivity. Code UI has one activity and no
 * per-account viewer, so the JavaScript side names the shortcut by the artifact alone and the
 * intent is a `codeui://artifact?…` link the router takes to the viewer route.
 *
 * requestPinShortcut(id, shortLabel, longLabel, uri) resolves one of:
 *  - "unsupported": the launcher cannot pin shortcuts;
 *  - "already": a shortcut with this id is pinned now (the system would only update it);
 *  - "pinned": the request was accepted, and the system's own confirm dialog follows. Whether the
 *    user then adds it is not reported back (the Claude app learns it through a broadcast; nothing
 *    here needs it);
 *  - "failed": the request was refused, or anything threw.
 *
 * openUrlOutsideApp(url) resolves "opened" | "none" | "failed": it opens a link in a browser
 * by package name, so a claude.ai link cannot bounce back into this app through its own intent
 * filter (mobile/src/session/open-outside-app.ts).
 *
 * A module under mobile/modules because Expo builds these in place; a mobile/packages module is
 * built from pnpm's copy in node_modules, which a local build only refreshes on `pnpm install`.
 */
class OrcaArtifactShortcutsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OrcaArtifactShortcuts")

    AsyncFunction("requestPinShortcut") { id: String, shortLabel: String, longLabel: String, uri: String ->
      val context = appContext.reactContext ?: return@AsyncFunction "failed"
      requestPin(context, id, shortLabel, longLabel, uri)
    }

    AsyncFunction("openUrlOutsideApp") { url: String ->
      val context = appContext.reactContext ?: return@AsyncFunction "failed"
      openOutside(context, url)
    }
  }

  /**
   * Opens `url` in a browser, never in this app. A plain VIEW on a claude.ai artifact link would
   * come straight back here once the user turns on "Open supported links" for Code UI (app.json's
   * claude.ai filter), so the link is sent to a browser package by name: the user's default
   * browser when one is set, else the first installed browser that is not this app.
   *
   * "opened" when an activity was started, "none" when no browser is installed, "failed" when
   * anything threw.
   */
  private fun openOutside(context: Context, url: String): String =
    try {
      val browser = defaultBrowser(context) ?: anyBrowser(context)
      if (browser == null) {
        "none"
      } else {
        context.startActivity(
          Intent(Intent.ACTION_VIEW, Uri.parse(url))
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .setPackage(browser)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        "opened"
      }
    } catch (error: Exception) {
      Log.w(TAG, "openUrlOutsideApp failed: ${error.javaClass.simpleName}: ${error.message}")
      "failed"
    }

  /** What a page on no app's domain resolves to: the browser, and nothing that claims claude.ai. */
  private fun browserProbe() =
    Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com")).addCategory(Intent.CATEGORY_BROWSABLE)

  /** The user's default browser, or null when none is set (the probe resolves to the chooser). */
  private fun defaultBrowser(context: Context): String? {
    val info = context.packageManager.resolveActivity(browserProbe(), PackageManager.MATCH_DEFAULT_ONLY)
      ?: return null
    val pkg = info.activityInfo?.packageName ?: return null
    val name = info.activityInfo?.name ?: ""
    val isChooser = pkg == "android" || pkg in CHOOSER_PACKAGES || name.endsWith("ResolverActivity")
    return if (isChooser || pkg == context.packageName) null else pkg
  }

  /** The first installed browser that is not this app. */
  private fun anyBrowser(context: Context): String? {
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PackageManager.MATCH_ALL else 0
    return context.packageManager.queryIntentActivities(browserProbe(), flags)
      .mapNotNull { it.activityInfo?.packageName }
      .firstOrNull { it != context.packageName && it != "android" && it !in CHOOSER_PACKAGES }
  }

  private fun requestPin(
    context: Context,
    id: String,
    shortLabel: String,
    longLabel: String,
    uri: String
  ): String =
    try {
      if (!ShortcutManagerCompat.isRequestPinShortcutSupported(context)) {
        "unsupported"
      } else if (
        ShortcutManagerCompat.getShortcuts(context, ShortcutManagerCompat.FLAG_MATCH_PINNED)
          .any { it.id == id }
      ) {
        "already"
      } else {
        val builder = ShortcutInfoCompat.Builder(context, id)
          .setShortLabel(shortLabel)
          .setLongLabel(longLabel)
          .setIntent(viewIntent(context, uri))
        launcherIcon(context)?.let { builder.setIcon(it) }
        if (ShortcutManagerCompat.requestPinShortcut(context, builder.build(), null)) "pinned" else "failed"
      }
    } catch (error: Exception) {
      // The one line a failed pin leaves behind names the call and why it threw.
      Log.w(TAG, "requestPinShortcut($id) failed: ${error.javaClass.simpleName}: ${error.message}")
      "failed"
    }

  /**
   * VIEW on the deep link, kept inside this app. CLEAR_TOP with the singleTask MainActivity
   * brings a running app forward and hands it the link (onNewIntent), as any codeui:// link does.
   */
  private fun viewIntent(context: Context, uri: String): Intent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    // Name the activity outright when it resolves, as the Claude app does, so the launcher never
    // has to resolve an implicit intent; the package alone is the fallback.
    intent.resolveActivity(context.packageManager)?.let { intent.component = it }
    return intent
  }

  /**
   * The app's launcher icon, by name: this module cannot see the app's R class. Prebuild writes
   * it as @mipmap/ic_launcher (the manifest's android:icon); applicationInfo.icon is the same
   * resource read from the manifest, should the name ever change.
   */
  private fun launcherIcon(context: Context): IconCompat? {
    val byName = context.resources.getIdentifier("ic_launcher", "mipmap", context.packageName)
    val resource = if (byName != 0) byName else context.applicationInfo.icon
    return if (resource != 0) IconCompat.createWithResource(context, resource) else null
  }

  private companion object {
    const val TAG = "OrcaArtifactShortcuts"

    /** The system chooser's package on Android 13+ (it was "android" before). */
    val CHOOSER_PACKAGES = setOf("com.android.intentresolver")
  }
}
