package expo.modules.orcaselectioncopy

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The view around a Markdown document whose Texts copy code pills as their words
 * (SelectionCopyRootView.kt). Android only: mobile/src/components/markdown-selection-copy.android.tsx
 * asks for it, and every other platform draws the document unwrapped.
 *
 * A module under mobile/modules because Expo builds these in place; a mobile/packages module is
 * built from pnpm's copy in node_modules, which a local build only refreshes on `pnpm install`.
 */
class OrcaSelectionCopyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OrcaSelectionCopy")

    View(SelectionCopyRootView::class) {}
  }
}
