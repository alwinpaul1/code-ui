package expo.modules.orcaselectioncopy

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The view around a Markdown document whose Texts select as the chat's do: Copy and Select all
 * only, handles and highlight in the app's accent, code pills copied as their words
 * (SelectionCopyRootView.kt). Android only: mobile/src/components/markdown-selection-copy.android.tsx
 * asks for it, and every other platform draws the document unwrapped.
 *
 * A module under mobile/modules because Expo builds these in place; a mobile/packages module is
 * built from pnpm's copy in node_modules, which a local build only refreshes on `pnpm install`.
 */
class OrcaSelectionCopyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OrcaSelectionCopy")

    View(SelectionCopyRootView::class) {
      // A Text inside opened or closed a selection (SelectionCopyRootView.selectionChanged).
      Events("onSelectionChange")

      // Android colour ints from processColor (chat-selection-colors.ts). Absent: the platform's.
      Prop("selectionHandleColor") { view: SelectionCopyRootView, color: Double? ->
        view.setSelectionHandleColor(colorIntOf(color))
      }

      Prop("selectionHighlightColor") { view: SelectionCopyRootView, color: Double? ->
        view.setSelectionHighlightColor(colorIntOf(color))
      }
    }
  }
}
