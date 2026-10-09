package expo.modules.orcanativeprose

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * A reply's prose drawn as one selectable TextView with hanging bullets and paragraph spacing
 * (NativeProseTextView), and the synchronous measure the JavaScript sizes it with. Android only:
 * mobile/src/components/native-prose-text.android.tsx asks for it; every other platform keeps the
 * React Native Text path.
 *
 * A module under mobile/modules because Expo builds these in place; a mobile/packages module is
 * built from pnpm's copy in node_modules, which a local build only refreshes on `pnpm install`.
 */
class OrcaNativeProseModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OrcaNativeProse")

    // Synchronous on purpose: the chat list must get the row's height in the same render that
    // mounts it, or every row would mount at no height and jump (FlashList measures on mount).
    // -1 when the spec cannot be drawn, and the log says why.
    Function("measure") { spec: String, width: Int ->
      try {
        NativeProseLayout.measure(ProseSpec.parse(spec), width, appContext.reactContext?.assets).toDouble()
      } catch (error: Exception) {
        Log.w(TAG, "Could not measure a ${spec.length}-character prose spec at $width px", error)
        -1.0
      }
    }

    View(NativeProseTextView::class) {
      Events("onLinkPress")

      Prop("spec") { view: NativeProseTextView, spec: String ->
        view.setSpec(spec)
      }

      Prop("layoutWidth") { view: NativeProseTextView, width: Int ->
        view.setLayoutWidth(width)
      }

      Prop("selectable") { view: NativeProseTextView, selectable: Boolean ->
        view.setWantsSelectable(selectable)
      }

      OnViewDidUpdateProps { view: NativeProseTextView ->
        view.applyProps()
      }
    }
  }
}
