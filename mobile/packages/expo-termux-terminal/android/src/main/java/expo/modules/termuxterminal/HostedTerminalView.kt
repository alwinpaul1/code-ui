package expo.modules.termuxterminal

import android.content.Context
import android.graphics.Rect
import com.termux.view.TerminalView

/**
 * Termux's view without its claim on focus. In Termux the view IS the keyboard's target: a tap
 * focuses it, `onCreateInputConnection` binds the IME and keystrokes go straight to the PTY. Here
 * the app's own live input owns focus and the IME (its mirror, accessory row and dictation all
 * hang off that TextInput), so this view must never take it: a tap that moved focus here would
 * drop the keyboard the same tap is meant to raise. Focus is refused, and the one place the view
 * insists on it, the `requestFocus()` gate on starting a text selection, is told it succeeded.
 */
class HostedTerminalView(context: Context) : TerminalView(context, null) {
  init {
    isFocusable = false
    isFocusableInTouchMode = false
  }

  override fun requestFocus(direction: Int, previouslyFocusedRect: Rect?): Boolean = true

  override fun onCheckIsTextEditor(): Boolean = false
}
