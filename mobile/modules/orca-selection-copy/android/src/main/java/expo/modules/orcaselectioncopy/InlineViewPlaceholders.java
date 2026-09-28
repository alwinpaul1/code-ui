package expo.modules.orcaselectioncopy;

import android.text.Spanned;
import androidx.annotation.Nullable;
import com.facebook.react.views.text.internal.span.TextInlineViewPlaceholderSpan;
import java.util.Arrays;
import java.util.Comparator;

/**
 * Reads React Native's inline-view placeholders out of a Text's characters.
 *
 * <p>Java, not Kotlin: TextInlineViewPlaceholderSpan is `internal` to react-android (RN 0.86.3),
 * which the Kotlin compiler enforces across modules and javac does not see. Its `reactTag` is the
 * inline View's tag (TextLayoutManager.kt, from the attachment fragment's own shadow view).
 */
final class InlineViewPlaceholders {
  private InlineViewPlaceholders() {}

  /** Whether the text holds any inline View at all. */
  static boolean any(@Nullable CharSequence text) {
    if (!(text instanceof Spanned)) {
      return false;
    }
    Spanned spanned = (Spanned) text;
    return spanned.getSpans(0, spanned.length(), TextInlineViewPlaceholderSpan.class).length > 0;
  }

  /**
   * The placeholders that start in [start, end), in text order, as pairs: {index, tag, index, tag,
   * ...}. One whose span does not cover exactly one character is left out: nothing here guesses
   * which character stands for it.
   */
  static int[] find(Spanned text, int start, int end) {
    TextInlineViewPlaceholderSpan[] spans =
        text.getSpans(start, end, TextInlineViewPlaceholderSpan.class);
    Arrays.sort(spans, Comparator.comparingInt(text::getSpanStart));
    int[] out = new int[spans.length * 2];
    int count = 0;
    for (TextInlineViewPlaceholderSpan span : spans) {
      int at = text.getSpanStart(span);
      if (at < start || at >= end || text.getSpanEnd(span) != at + 1) {
        continue;
      }
      out[count++] = at;
      out[count++] = span.getReactTag();
    }
    return Arrays.copyOf(out, count);
  }
}
