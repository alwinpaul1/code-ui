package expo.modules.orcanativeprose

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.text.Spanned
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.LineHeightSpan
import android.text.style.MetricAffectingSpan
import android.text.style.ReplacementSpan
import android.text.style.UpdateAppearance
import kotlin.math.ceil

/**
 * Every line of one paragraph exactly [lineHeight] pixels tall, its type centred in the line as a
 * React Native Text centres it (CustomLineHeightSpan), and [spaceAfter] pixels added below the
 * paragraph's LAST line only: the air between two bullets and the 7 dp blank line between blocks.
 *
 * The span covers the paragraph and the newline that ends it, so a line whose end reaches the
 * span's end is the paragraph's last. StaticLayout sets [fm] from the line's own type before
 * asking (StaticLayout.out), so nothing here builds up from one line to the next.
 */
internal class ProseLineSpan(private val lineHeight: Int, private val spaceAfter: Int) : LineHeightSpan {
  override fun chooseHeight(
    text: CharSequence,
    start: Int,
    end: Int,
    spanstartv: Int,
    lineHeightUnused: Int,
    fm: Paint.FontMetricsInt
  ) {
    val extra = lineHeight - (fm.descent - fm.ascent)
    fm.ascent -= ceil(extra / 2.0).toInt()
    fm.descent = fm.ascent + lineHeight
    fm.top = fm.ascent
    fm.bottom = fm.descent
    val spanEnd = (text as? Spanned)?.getSpanEnd(this) ?: return
    if (spaceAfter > 0 && end >= spanEnd) {
      fm.descent += spaceAfter
      fm.bottom += spaceAfter
    }
  }
}

/** A face of the app's own (expo-font registered it with React Native's font manager). A fake
 *  italic StyleSpan applied around it keeps its skew. */
internal class FaceSpan(private val typeface: Typeface) : MetricAffectingSpan() {
  override fun updateMeasureState(paint: TextPaint) {
    paint.typeface = typeface
  }

  override fun updateDrawState(paint: TextPaint) {
    paint.typeface = typeface
  }
}

/**
 * Inline code's words: the code face, its size and its colour. A MetricAffectingSpan and not a
 * ForegroundColorSpan for the colour, because the pill's first and last characters are drawn by
 * [PillEdgeSpan], and Android hands a ReplacementSpan a paint with only the metric spans applied
 * (TextLine.handleRun), so a colour span would leave those two characters in the body colour.
 */
internal class CodeFaceSpan(
  private val typeface: Typeface,
  private val size: Float,
  private val color: Int,
  private val underline: Boolean
) : MetricAffectingSpan() {
  // Code is never slanted or thickened by the italic or bold around it, as the Text path's pill
  // never was: a StyleSpan set before this one may have faked either on the paint.
  override fun updateMeasureState(paint: TextPaint) {
    paint.typeface = typeface
    paint.textSize = size
    paint.textSkewX = 0f
    paint.isFakeBoldText = false
  }

  override fun updateDrawState(paint: TextPaint) {
    updateMeasureState(paint)
    paint.color = color
    paint.isUnderlineText = underline
  }
}

/**
 * The pill's padding: the first character of a code span drawn [before] pixels in, the last with
 * [after] pixels of room behind it. The characters stay themselves, so a Copy takes the code's
 * words as they are; only their advance grows. The pill's fill is drawn behind the line by
 * NativeProseTextView, from the span's extent on each line.
 */
internal class PillEdgeSpan(private val before: Float, private val after: Float) : ReplacementSpan() {
  override fun getSize(paint: Paint, text: CharSequence, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
    if (fm != null) {
      paint.getFontMetricsInt(fm)
    }
    return ceil(paint.measureText(text, start, end) + before + after).toInt()
  }

  override fun draw(
    canvas: Canvas,
    text: CharSequence,
    start: Int,
    end: Int,
    x: Float,
    top: Int,
    y: Int,
    bottom: Int,
    paint: Paint
  ) {
    // A file path in code is underlined through the paint's flag, which drawText honours.
    canvas.drawText(text, start, end, x + before, y.toFloat(), paint)
  }
}

/** A link's words in the link colour, underlined, and which link they open. */
internal class ProseLinkSpan(val link: Int, private val color: Int) : CharacterStyle(), UpdateAppearance {
  override fun updateDrawState(paint: TextPaint) {
    paint.color = color
    paint.isUnderlineText = true
  }
}

/** The extent of one inline code span, which the view draws a pill behind. */
internal data class PillRange(val start: Int, val end: Int)
