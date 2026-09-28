package expo.modules.orcaselectioncopy

/**
 * What a Copy from a selection in a Markdown Text puts in place of the code pills in it.
 *
 * A code pill is an inline View inside the prose Text (MobileMarkdownCodeChip.tsx). React Native
 * 0.86.3 stands such a View in the Text's characters as one U+FFFC under a
 * TextInlineViewPlaceholderSpan that carries the View's tag (TextLayoutManager.kt). The TextView's
 * own Copy puts that U+FFFC on the clipboard, so "only when someone runs `cdk deploy`." pasted as
 * "only when someone runs ￼." (2026-09-28). The pill's words are in a Text of its own, inside the
 * View, and a span split across lines is one pill per line, each cut without the space it was cut
 * at, so they are not read from there: each pill's View carries its whole span in its nativeID
 * ([PillCopyText]).
 */

/** U+FFFC, the character React Native puts in a Text's string for each inline View. */
internal const val INLINE_VIEW_CHARACTER = '￼'

/**
 * A pill's copy text, from its View's nativeID `codeui-pill:<piece>:<span>`, as
 * mobile/src/components/markdown-pill-copy-id.ts writes it. `span` is the whole code span, the same
 * on every piece of it; `piece` is this pill's place in it, 0 for the first.
 */
internal data class PillCopyText(val piece: Int, val span: String) {
  companion object {
    const val NATIVE_ID_PREFIX = "codeui-pill:"

    /** Null for any nativeID that is not exactly that shape: nothing is guessed from a near miss. */
    fun fromNativeId(nativeId: String?): PillCopyText? {
      if (nativeId == null || !nativeId.startsWith(NATIVE_ID_PREFIX)) {
        return null
      }
      val separator = nativeId.indexOf(':', NATIVE_ID_PREFIX.length)
      if (separator < 0) {
        return null
      }
      val digits = nativeId.substring(NATIVE_ID_PREFIX.length, separator)
      if (digits.isEmpty() || !digits.all { it in '0'..'9' }) {
        return null
      }
      val piece = digits.toIntOrNull() ?: return null
      val span = nativeId.substring(separator + 1)
      // A pill is never cut from an empty span (isInlineCodeChip), and copying one as nothing
      // would drop it without a trace.
      return if (span.isEmpty()) null else PillCopyText(piece, span)
    }
  }
}

/**
 * One inline View in a Text: the index of its U+FFFC, and its copy text, or null when its View
 * could not be found or carries none (a figure is an inline View too).
 */
internal data class InlinePlaceholder(val index: Int, val pill: PillCopyText?)

/** A Copy's edits to the selected characters, by their index in the Text. */
internal data class PillCopyPlan(
  /** Each U+FFFC replaced, and by what: its span's text, or "" for a later piece of a span the
   *  copy already holds. */
  val replacements: List<Pair<Int, String>>,
  /** Placeholders left as they are: nothing says what they copy as, or the Text's character at
   *  that index is not U+FFFC. */
  val kept: List<Int>
) {
  /** Replaces, last first, so each index still points where it did. `replace` takes indices into
   *  the copy, which starts at `start` in the Text. */
  fun applyTo(start: Int, replace: (from: Int, to: Int, with: String) -> Unit) {
    for ((index, with) in replacements.sortedByDescending { it.first }) {
      replace(index - start, index - start + 1, with)
    }
  }
}

/** The selection as indices into `length` characters, lower first, clamped to the text. */
internal fun selectionRange(selectionStart: Int, selectionEnd: Int, length: Int): IntRange {
  val start = minOf(selectionStart, selectionEnd).coerceIn(0, length)
  val end = maxOf(selectionStart, selectionEnd).coerceIn(0, length)
  return start until end
}

/**
 * What a Copy of the selection puts in place of each placeholder in it.
 *
 * Each pill copies as its whole span, once. A span split across lines is several pills, and their
 * placeholders sit side by side with nothing between (MobileMarkdown.tsx pushes the pieces one
 * after another), so a piece right after the piece before it of the same span copies as nothing.
 * Any other piece copies the whole span: a selection that starts on a span's second line still
 * gets all of it, since the android API gives no way to copy part of a View.
 *
 * A placeholder with no copy text keeps its U+FFFC, and so does one whose index does not hold
 * U+FFFC. Neither changes a character around it.
 */
internal fun planPillCopy(
  text: CharSequence,
  selectionStart: Int,
  selectionEnd: Int,
  placeholders: List<InlinePlaceholder>
): PillCopyPlan {
  val range = selectionRange(selectionStart, selectionEnd, text.length)
  val selected = placeholders.filter { it.index in range }.sortedBy { it.index }
  val byIndex = selected.associateBy { it.index }
  val replacements = mutableListOf<Pair<Int, String>>()
  val kept = mutableListOf<Int>()
  for (placeholder in selected) {
    val pill = placeholder.pill
    if (pill == null || text[placeholder.index] != INLINE_VIEW_CHARACTER) {
      kept += placeholder.index
      continue
    }
    val before = byIndex[placeholder.index - 1]?.pill
    val continuesSpan =
      pill.piece > 0 && before != null && before.span == pill.span && before.piece == pill.piece - 1
    replacements += placeholder.index to (if (continuesSpan) "" else pill.span)
  }
  return PillCopyPlan(replacements, kept)
}

/** The selected characters as a Copy should put them on the clipboard, as plain text. */
internal fun copyWithPills(
  text: CharSequence,
  selectionStart: Int,
  selectionEnd: Int,
  placeholders: List<InlinePlaceholder>
): String {
  val range = selectionRange(selectionStart, selectionEnd, text.length)
  val out = StringBuilder(text.subSequence(range.first, range.last + 1))
  planPillCopy(text, selectionStart, selectionEnd, placeholders).applyTo(range.first) { from, to, with ->
    out.replace(from, to, with)
  }
  return out.toString()
}
