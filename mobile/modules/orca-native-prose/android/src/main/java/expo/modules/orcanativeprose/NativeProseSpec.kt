package expo.modules.orcanativeprose

import org.json.JSONObject

/**
 * One prose run of a reply, as mobile/src/components/native-prose-model.ts builds it and
 * native-prose-spec.ts wraps it with the theme and the zoom. Field for field the same shape; sizes
 * are dp (indents, gaps, the pill's padding) or sp (type and line heights), at no zoom.
 */
internal data class ProseParagraph(
  val kind: String,
  val start: Int,
  val end: Int,
  val fontSize: Float,
  val lineHeight: Float,
  val spaceAfter: Float,
  val indent: Float,
  val hang: Int,
  /** -1 when the paragraph hangs on its own. */
  val alignTo: Int
)

internal data class ProseSpanSpec(val start: Int, val end: Int, val style: String, val link: Int)

internal data class ProseColors(
  val text: Int,
  val link: Int,
  val codeText: Int,
  val codeBackground: Int,
  val codeBorder: Int,
  val rule: Int,
  val marker: Int
)

internal data class ProseFonts(val regular: String, val bold: String, val mono: String)

internal data class ProseChip(
  val fontSize: Float,
  val lineHeight: Float,
  val paddingHorizontal: Float,
  val borderWidth: Float,
  val radius: Float
)

internal data class ProseSpec(
  val text: String,
  val paragraphs: List<ProseParagraph>,
  val spans: List<ProseSpanSpec>,
  val linkCount: Int,
  val scale: Float,
  val fontSize: Float,
  val colors: ProseColors,
  val fonts: ProseFonts,
  val chip: ProseChip
) {
  companion object {
    /** Throws on a spec that is not this shape; the caller says so in the log and draws nothing
     *  rather than a guess. */
    fun parse(json: String): ProseSpec {
      val root = JSONObject(json)
      val model = root.getJSONObject("model")
      val text = model.getString("text")
      val paragraphsJson = model.getJSONArray("paragraphs")
      val paragraphs =
        (0 until paragraphsJson.length()).map { index ->
          val p = paragraphsJson.getJSONObject(index)
          ProseParagraph(
            kind = p.getString("kind"),
            start = p.getInt("start"),
            end = p.getInt("end"),
            fontSize = p.getDouble("fontSize").toFloat(),
            lineHeight = p.getDouble("lineHeight").toFloat(),
            spaceAfter = p.getDouble("spaceAfter").toFloat(),
            indent = p.getDouble("indent").toFloat(),
            hang = p.getInt("hang"),
            alignTo = if (p.has("alignTo")) p.getInt("alignTo") else -1
          )
        }
      val spansJson = model.getJSONArray("spans")
      val spans =
        (0 until spansJson.length()).map { index ->
          val s = spansJson.getJSONObject(index)
          ProseSpanSpec(
            start = s.getInt("start"),
            end = s.getInt("end"),
            style = s.getString("style"),
            link = if (s.has("link")) s.getInt("link") else -1
          )
        }
      val colors = root.getJSONObject("colors")
      val fonts = root.getJSONObject("fonts")
      val chip = root.getJSONObject("chip")
      return ProseSpec(
        text = text,
        paragraphs = paragraphs,
        spans = spans,
        linkCount = model.getJSONArray("links").length(),
        scale = root.getDouble("scale").toFloat(),
        fontSize = root.getDouble("fontSize").toFloat(),
        colors =
          ProseColors(
            text = colors.getLong("text").toInt(),
            link = colors.getLong("link").toInt(),
            codeText = colors.getLong("codeText").toInt(),
            codeBackground = colors.getLong("codeBackground").toInt(),
            codeBorder = colors.getLong("codeBorder").toInt(),
            rule = colors.getLong("rule").toInt(),
            marker = colors.getLong("marker").toInt()
          ),
        fonts = ProseFonts(fonts.getString("regular"), fonts.getString("bold"), fonts.getString("mono")),
        chip =
          ProseChip(
            fontSize = chip.getDouble("fontSize").toFloat(),
            lineHeight = chip.getDouble("lineHeight").toFloat(),
            paddingHorizontal = chip.getDouble("paddingHorizontal").toFloat(),
            borderWidth = chip.getDouble("borderWidth").toFloat(),
            radius = chip.getDouble("radius").toFloat()
          )
      )
    }
  }
}
