package expo.modules.orcanativeprose

import android.content.res.AssetManager
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Build
import android.text.Layout
import android.text.SpannableString
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextDirectionHeuristics
import android.text.TextPaint
import android.text.style.AbsoluteSizeSpan
import android.text.style.ForegroundColorSpan
import android.text.style.LeadingMarginSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.util.Log
import com.facebook.react.common.assets.ReactFontManager
import com.facebook.react.uimanager.PixelUtil
import kotlin.math.roundToInt

internal const val TAG = "OrcaNativeProse"

/** How the view draws a pill behind each inline code span. */
internal class PillStyle(
  val fill: Int,
  val border: Int,
  val borderWidth: Float,
  val radius: Float,
  /** The pill's whole height: the code's line and its two borders. */
  val height: Float,
  /** The code's paint, for where its text sits on a line. */
  val codePaint: TextPaint
)

/** A spec turned into what Android draws: the text with its spans, the paint the rest of the text
 *  is set in, and the pills to draw behind it. */
internal class BuiltProse(
  val text: SpannableString,
  val paint: TextPaint,
  val pills: List<PillRange>,
  val pillStyle: PillStyle,
  val textColor: Int
)

/**
 * One builder for the measure the JavaScript asks for (OrcaNativeProseModule.measure) and the text
 * the view draws (NativeProseTextView), so a reply is laid out once by one set of rules and the
 * height React Native gives the view is the height the view draws.
 *
 * Type and line heights are sp and indents dp, turned into pixels exactly as a React Native Text
 * turns its own (PixelUtil), so the system font size moves this text as it moves every other.
 */
internal object NativeProseLayout {
  fun build(spec: ProseSpec, assets: AssetManager?): BuiltProse {
    val scale = spec.scale
    fun sp(value: Float) = PixelUtil.toPixelFromSP(value * scale)
    fun dp(value: Float) = PixelUtil.toPixelFromDIP(value * scale)
    val fonts = ReactFontManager.getInstance()
    val regular = fonts.getTypeface(spec.fonts.regular, Typeface.NORMAL, assets)
    val bold = fonts.getTypeface(spec.fonts.bold, Typeface.NORMAL, assets)
    val mono = fonts.getTypeface(spec.fonts.mono, Typeface.NORMAL, assets)

    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG)
    paint.typeface = regular
    paint.textSize = sp(spec.fontSize)
    paint.color = spec.colors.text
    // As NativeProseTextView sets it: Android 15 turns elegant text height on for a TextView by
    // default, which changes advances in some scripts and so where lines break.
    paint.isElegantTextHeight = false

    val text = SpannableString(spec.text)
    val length = text.length
    fun valid(start: Int, end: Int) = start in 0..end && end <= length

    // Paragraphs first: each one's line height, space after, size and hanging margin, over its
    // words and the newline that ends it.
    val hangingMargins = IntArray(spec.paragraphs.size)
    spec.paragraphs.forEachIndexed { index, paragraph ->
      if (!valid(paragraph.start, paragraph.end)) {
        Log.w(TAG, "Paragraph $index [${paragraph.start}, ${paragraph.end}) is outside a $length-character text")
        return@forEachIndexed
      }
      val reach = if (paragraph.end < length) paragraph.end + 1 else paragraph.end
      if (reach <= paragraph.start) {
        return@forEachIndexed
      }
      val size = sp(paragraph.fontSize)
      text.setSpan(
        ProseLineSpan(sp(paragraph.lineHeight).roundToInt(), dp(paragraph.spaceAfter).roundToInt()),
        paragraph.start,
        reach,
        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
      )
      if (paragraph.fontSize != spec.fontSize) {
        text.setSpan(AbsoluteSizeSpan(size.roundToInt()), paragraph.start, reach, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
      val first = dp(paragraph.indent).roundToInt()
      val aligned = paragraph.alignTo.takeIf { it in 0 until index }?.let { hangingMargins[it] }
      val rest =
        aligned
          ?: if (paragraph.hang > 0 && paragraph.start + paragraph.hang <= paragraph.end) {
            // The marker and its space, measured in the paint they are drawn in: the paragraph's
            // size, the body face.
            val markerPaint = TextPaint(paint)
            markerPaint.textSize = size
            first + markerPaint.measureText(spec.text, paragraph.start, paragraph.start + paragraph.hang).roundToInt()
          } else {
            first
          }
      hangingMargins[index] = rest
      val firstLine = aligned ?: first
      if (firstLine > 0 || rest > 0) {
        text.setSpan(LeadingMarginSpan.Standard(firstLine, rest), paragraph.start, reach, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
    }

    val linkRanges = spec.spans.filter { it.style == "link" }.map { it.start to it.end }.toSet()
    val pills = mutableListOf<PillRange>()
    val chipSize = sp(spec.chip.fontSize)
    val pad = dp(spec.chip.paddingHorizontal) + PixelUtil.toPixelFromDIP(spec.chip.borderWidth)
    for (span in spec.spans) {
      if (!valid(span.start, span.end) || span.start == span.end) {
        Log.w(TAG, "Span ${span.style} [${span.start}, ${span.end}) is outside a $length-character text")
        continue
      }
      val flags = Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
      when (span.style) {
        "bold" -> text.setSpan(FaceSpan(bold), span.start, span.end, flags)
        "italic" -> text.setSpan(StyleSpan(Typeface.ITALIC), span.start, span.end, flags)
        "strike" -> text.setSpan(StrikethroughSpan(), span.start, span.end, flags)
        "marker" -> text.setSpan(ForegroundColorSpan(spec.colors.marker), span.start, span.end, flags)
        "rule" -> text.setSpan(ForegroundColorSpan(spec.colors.rule), span.start, span.end, flags)
        "link" ->
          if (span.link in 0 until spec.linkCount) {
            text.setSpan(ProseLinkSpan(span.link, spec.colors.link), span.start, span.end, flags)
          }
        "labelCode" -> {
          text.setSpan(FaceSpan(mono), span.start, span.end, flags)
          text.setSpan(AbsoluteSizeSpan(chipSize.roundToInt()), span.start, span.end, flags)
        }
        "code" -> {
          val linked = (span.start to span.end) in linkRanges
          text.setSpan(
            CodeFaceSpan(mono, chipSize, if (linked) spec.colors.link else spec.colors.codeText, linked),
            span.start,
            span.end,
            flags
          )
          addPillEdges(text, span.start, span.end, pad)
          pills += PillRange(span.start, span.end)
        }
        else -> Log.w(TAG, "Span style \"${span.style}\" is not one this view draws; drawn as plain text")
      }
    }

    val codePaint = TextPaint(paint)
    codePaint.typeface = mono
    codePaint.textSize = chipSize
    val borderWidth = PixelUtil.toPixelFromDIP(spec.chip.borderWidth)
    val pillStyle =
      PillStyle(
        fill = spec.colors.codeBackground,
        border = spec.colors.codeBorder,
        borderWidth = borderWidth,
        radius = dp(spec.chip.radius),
        height = sp(spec.chip.lineHeight) + 2 * borderWidth,
        codePaint = codePaint
      )
    return BuiltProse(text, paint, pills, pillStyle, spec.colors.text)
  }

  /** The pill's padding on the span's first and last characters (PillEdgeSpan). A code point
   *  outside the BMP is two chars, and both go under the one span. A newline is left alone: it
   *  draws nothing for padding to sit beside. */
  private fun addPillEdges(text: SpannableString, start: Int, end: Int, pad: Float) {
    val string = text.toString()
    val firstEnd = start + Character.charCount(string.codePointAt(start))
    val lastStart = end - Character.charCount(string.codePointBefore(end))
    val flags = Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
    if (lastStart <= start) {
      if (string[start] != '\n') {
        text.setSpan(PillEdgeSpan(pad, pad), start, end, flags)
      }
      return
    }
    if (string[start] != '\n') {
      text.setSpan(PillEdgeSpan(pad, 0f), start, firstEnd, flags)
    }
    if (string[lastStart] != '\n') {
      text.setSpan(PillEdgeSpan(0f, pad), lastStart, end, flags)
    }
  }

  /** The layout the view's TextView makes of the same text: the same break strategy, no font
   *  padding, no fallback line spacing (NativeProseTextView sets each to match). */
  fun staticLayout(built: BuiltProse, width: Int): StaticLayout {
    val builder =
      StaticLayout.Builder.obtain(built.text, 0, built.text.length, built.paint, maxOf(0, width))
        .setAlignment(Layout.Alignment.ALIGN_NORMAL)
        .setLineSpacing(0f, 1f)
        .setIncludePad(false)
        .setBreakStrategy(Layout.BREAK_STRATEGY_SIMPLE)
        .setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
        .setTextDirection(TextDirectionHeuristics.FIRSTSTRONG_LTR)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      builder.setUseLineSpacingFromFallbacks(false)
    }
    return builder.build()
  }

  /** The text's height in pixels at [width] pixels wide. */
  fun measure(spec: ProseSpec, width: Int, assets: AssetManager?): Int = staticLayout(build(spec, assets), width).height
}
