package expo.modules.orcanativeprose

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Build
import android.text.Layout
import android.text.Spanned
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.widget.TextView
import expo.modules.kotlin.viewevent.EventDispatcher
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * One prose run of a reply in ONE TextView, so a hold's selection handles drag across its
 * paragraphs and bullets and a Copy takes the words as drawn (the bullet as "•", the code's words,
 * no Markdown marks). Android selection cannot cross TextViews; this keeps every item in one.
 *
 * React Native lays the view out at the height the JavaScript measured with the same builder
 * (NativeProseLayout.measure); [layoutWidth] is the width that height was measured at, the floor
 * of the view's width in pixels (native-prose-spec.ts), and the right padding takes up any pixel
 * the rounding gave the view beyond it, so the text breaks its lines where the measure did. A view
 * narrower than [layoutWidth] cannot be widened here; the mismatch is logged (onLayout).
 *
 * Selection is the JavaScript's to switch: off while the chat list scrolls, so a finger that stops
 * a fling and stays down does not start one (chat-text-selectable-context.ts, 2026-09-12).
 */
class NativeProseTextView(context: Context) : TextView(context) {
  private val onLinkPress by EventDispatcher()

  private var specJson: String? = null
  private var appliedSpec: String? = null
  private var layoutWidth = 0
  private var wantsSelectable = false
  private var built: BuiltProse? = null
  private var expectedHeight = -1

  private val pillFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val pillStroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private val pillRect = RectF()
  private val codeMetrics = Paint.FontMetrics()

  private var downX = 0f
  private var downY = 0f
  private var downAt = 0L
  private var downLink = -1

  init {
    includeFontPadding = false
    breakStrategy = Layout.BREAK_STRATEGY_SIMPLE
    hyphenationFrequency = Layout.HYPHENATION_FREQUENCY_NONE
    setLineSpacing(0f, 1f)
    setPadding(0, 0, 0, 0)
    gravity = Gravity.TOP or Gravity.START
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      isFallbackLineSpacing = false
    }
    setBackgroundColor(Color.TRANSPARENT)
    // Android 15 turns this on for a TextView by default; the measure's paint has it off, and the
    // two must break lines alike (NativeProseLayout.build).
    isElegantTextHeight = false
  }

  fun setSpec(json: String) {
    specJson = json
  }

  fun setLayoutWidth(width: Int) {
    layoutWidth = width
  }

  fun setWantsSelectable(selectable: Boolean) {
    wantsSelectable = selectable
  }

  /** After a batch of props: the text, if its spec changed, then selection. */
  fun applyProps() {
    val json = specJson
    if (json != null && json != appliedSpec) {
      appliedSpec = json
      val next =
        try {
          NativeProseLayout.build(ProseSpec.parse(json), context.assets)
        } catch (error: Exception) {
          // One line that says where to look; the view draws nothing rather than a guess.
          Log.w(TAG, "Could not draw a ${json.length}-character prose spec", error)
          null
        }
      built = next
      if (next != null) {
        setTextSize(TypedValue.COMPLEX_UNIT_PX, next.paint.textSize)
        typeface = next.paint.typeface
        setTextColor(next.textColor)
        text = next.text
        expectedHeight = NativeProseLayout.staticLayout(next, layoutWidth).height
      } else {
        text = ""
        expectedHeight = -1
      }
    }
    if (isTextSelectable != wantsSelectable) {
      setTextIsSelectable(wantsSelectable)
    }
    fitTextToLayoutWidth()
    relayout()
  }

  /** Lays the text out at [layoutWidth] pixels when the view is at least that wide: the right
   *  padding takes up the pixels rounding gave it beyond the width the height was measured at. */
  private fun fitTextToLayoutWidth() {
    val spare = if (layoutWidth > 0 && width > 0) max(0, width - layoutWidth) else 0
    if (paddingRight != spare) {
      setPadding(0, 0, spare, 0)
    }
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    fitTextToLayoutWidth()
  }

  /** React Native does not lay out a native child that asks for it (Fabric owns the size), so a
   *  new text is laid out here at the size the view already has. */
  private fun relayout() {
    if (width == 0 || height == 0) {
      return
    }
    measure(
      View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY)
    )
    layout(left, top, right, bottom)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    val drawn = layout?.height ?: return
    if (expectedHeight >= 0 && drawn != expectedHeight) {
      // The measure and the TextView disagreed: a line will be cut or a gap left. Say so, with
      // the numbers, once per text, rather than leave a clipped reply with no trace.
      Log.w(TAG, "Drawn text is $drawn px tall where the measure said $expectedHeight px (width $layoutWidth px)")
      expectedHeight = -1
    }
  }

  override fun onDraw(canvas: Canvas) {
    drawPills(canvas)
    super.onDraw(canvas)
  }

  /** A rounded pill behind each inline code span, one per line the span crosses, under the
   *  selection highlight and the words (the TextView draws both after this). */
  private fun drawPills(canvas: Canvas) {
    val prose = built ?: return
    val layout = layout ?: return
    if (prose.pills.isEmpty()) {
      return
    }
    val style = prose.pillStyle
    style.codePaint.getFontMetrics(codeMetrics)
    pillFill.color = style.fill
    pillStroke.color = style.border
    pillStroke.strokeWidth = style.borderWidth
    val text = layout.text
    val half = style.height / 2f
    val inset = style.borderWidth / 2f
    canvas.save()
    canvas.translate(compoundPaddingLeft.toFloat(), extendedPaddingTop.toFloat())
    for (pill in prose.pills) {
      val start = min(pill.start, text.length)
      val end = min(pill.end, text.length)
      if (end <= start) {
        continue
      }
      val firstLine = layout.getLineForOffset(start)
      val lastLine = layout.getLineForOffset(end - 1)
      for (line in firstLine..lastLine) {
        val lineStart = max(start, layout.getLineStart(line))
        val lineEnd = layout.getLineEnd(line)
        var pieceEnd = min(end, lineEnd)
        while (pieceEnd > lineStart && text[pieceEnd - 1] == '\n') {
          pieceEnd -= 1
        }
        if (pieceEnd <= lineStart) {
          continue
        }
        val left = layout.getPrimaryHorizontal(lineStart)
        // An offset at the line's end reads as the next line's start, so the piece that runs to
        // the end of its line ends where the line's words do (getLineMax counts the margin).
        val right = if (pieceEnd < lineEnd) layout.getPrimaryHorizontal(pieceEnd) else layout.getLineMax(line)
        if (right <= left) {
          continue
        }
        val baseline = layout.getLineBaseline(line).toFloat()
        val centre = baseline + (codeMetrics.ascent + codeMetrics.descent) / 2f
        pillRect.set(left + inset, centre - half + inset, right - inset, centre + half - inset)
        canvas.drawRoundRect(pillRect, style.radius, style.radius, pillFill)
        if (style.borderWidth > 0f) {
          canvas.drawRoundRect(pillRect, style.radius, style.radius, pillStroke)
        }
      }
    }
    canvas.restore()
  }

  /**
   * A tap on a link's words opens it; anything else is the TextView's (a hold selects). A
   * selectable TextView does not run a ClickableSpan, and React Native's own link press goes
   * through a Text this is not, so the tap is found here and handed to the JavaScript.
   */
  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = event.x
        downY = event.y
        downAt = event.eventTime
        downLink = linkAt(event.x, event.y)
      }
      MotionEvent.ACTION_UP -> {
        val link = downLink
        downLink = -1
        val slop = ViewConfiguration.get(context).scaledTouchSlop
        val tapped =
          link >= 0 &&
            abs(event.x - downX) < slop &&
            abs(event.y - downY) < slop &&
            event.eventTime - downAt < ViewConfiguration.getLongPressTimeout() &&
            !hasSelection() &&
            linkAt(event.x, event.y) == link
        if (tapped) {
          onLinkPress(mapOf("link" to link))
          super.onTouchEvent(event)
          return true
        }
      }
      MotionEvent.ACTION_CANCEL -> downLink = -1
    }
    val handled = super.onTouchEvent(event)
    // Not selectable, a TextView turns the down away, and the up of a tap on a link would never
    // come here.
    return handled || (event.actionMasked == MotionEvent.ACTION_DOWN && downLink >= 0)
  }

  private fun linkAt(x: Float, y: Float): Int {
    val layout = layout ?: return -1
    val text = layout.text as? Spanned ?: return -1
    val localY = y - totalPaddingTop + scrollY
    val localX = x - totalPaddingLeft + scrollX
    if (localY < 0 || localY > layout.height) {
      return -1
    }
    val line = layout.getLineForVertical(localY.toInt())
    if (localX < layout.getLineLeft(line) || localX > layout.getLineMax(line)) {
      return -1
    }
    val offset = layout.getOffsetForHorizontal(line, localX)
    val spans = text.getSpans(offset, offset, ProseLinkSpan::class.java)
    // Only the link that holds the character under the finger: getSpans also returns a span that
    // merely ends or starts at the offset, a tap on the word beside it.
    return spans.firstOrNull { text.getSpanStart(it) <= offset && offset < text.getSpanEnd(it) }?.link ?: -1
  }
}
