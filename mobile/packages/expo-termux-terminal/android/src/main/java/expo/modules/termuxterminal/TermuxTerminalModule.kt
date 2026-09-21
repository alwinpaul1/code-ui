package expo.modules.termuxterminal

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TermuxTerminalModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TermuxTerminal")

    View(TermuxTerminalView::class) {
      Events("onInput", "onResize", "onModes", "onSelection", "onCopy", "onFontSize", "onTap", "onMetrics")

      Prop("fontSize") { view: TermuxTerminalView, dp: Float -> view.setFontSizeDp(dp) }
      Prop("theme") { view: TermuxTerminalView, theme: Map<String, Any?>? -> view.setTheme(theme) }

      AsyncFunction("writeText") { view: TermuxTerminalView, text: String -> view.writeText(text) }
      AsyncFunction("cancelSelect") { view: TermuxTerminalView -> view.cancelSelect() }
    }
  }
}
