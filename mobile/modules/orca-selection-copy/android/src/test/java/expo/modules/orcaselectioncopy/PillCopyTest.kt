package expo.modules.orcaselectioncopy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The Text strings below are what React Native 0.86.3 puts in a Markdown prose Text on Android:
 * the words as drawn, list markers and blank lines included, and one U+FFFC per pill View.
 *
 * The first is the reply in the report of 2026-09-28 (copy-pill-fffc.png), from the third list
 * item down; the items above it were off screen. MobileMarkdown draws the list and the paragraphs
 * of one run in one Text, so both pills are in the same Text. The user selected "One catch: ..."
 * and pasted "...only when someone runs ￼. I haven't confirmed...".
 */
private const val P = INLINE_VIEW_CHARACTER

private val REPLY =
  "3.  The email goes out through Cloudflare Email Sending (SMTP), from noreply@nexdash.com, to " +
    "the email address on that person's account.\n\n" +
    "The code tries mail services in order: Amazon SES, then Resend, then SMTP. In the production " +
    "setup ($P), SES is switched off and Cloudflare SMTP is configured, so SMTP is what sends it.\n\n" +
    "One catch: that SMTP setup comes from PR #1129 and reaches production only when someone runs " +
    "$P. I haven't confirmed that has happened. If it hasn't, the email fails quietly: the password " +
    "is still set, and the server logs the email error.\n\n" +
    "session:ok"

private val REPLY_PILLS = listOf("infra/lib/nexos-stack.ts", "cdk deploy")

/**
 * The Worktree item of 2026-09-26 as the phone cuts it at 360 dp
 * (mobile-markdown-code-pill-flow.test.ts): the path's first piece ends the "Worktree:" line and
 * its second starts the next, with nothing between the two placeholders.
 */
private val WORKTREE =
  "•  Worktree: $P$P. Branch $P, commits $P and $P on top of $P $P."
private const val PATH = "/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows"
private val WORKTREE_PILLS = listOf(
  PillCopyText(0, PATH),
  PillCopyText(1, PATH),
  PillCopyText(0, "fix/chat-rows"),
  PillCopyText(0, "68a160e5"),
  PillCopyText(0, "06b32d5e"),
  PillCopyText(0, "main"),
  PillCopyText(0, "4f46fd47")
)

/** A span longer than a line, cut into three (the same test file, at 300 dp). */
private val PROBES = "The review probes are in $P$P$P. Copy them in."
private const val PROBES_PATH =
  "/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/790eafa8-07b2-4380-abc2-90e22f965369/scratchpad/chat-rows-review-probes/"

/** Each U+FFFC in `text`, in order, with the pill it stands for. */
private fun placeholders(text: String, pills: List<PillCopyText?>): List<InlinePlaceholder> {
  val indices = text.indices.filter { text[it] == P }
  assertEquals("one pill per U+FFFC in the fixture", indices.size, pills.size)
  return indices.zip(pills) { index, pill -> InlinePlaceholder(index, pill) }
}

private fun copy(text: String, start: Int, end: Int, pills: List<PillCopyText?>): String =
  copyWithPills(text, start, end, placeholders(text, pills))

private fun whole(pills: List<String>) = pills.map { PillCopyText(0, it) }

class PillCopyTest {
  @Test
  fun `copies the cdk deploy pill as its words, not U+FFFC`() {
    val start = REPLY.indexOf("One catch")
    val end = REPLY.indexOf("\n\nsession:ok")
    assertEquals(
      "One catch: that SMTP setup comes from PR #1129 and reaches production only when someone " +
        "runs cdk deploy. I haven't confirmed that has happened. If it hasn't, the email fails " +
        "quietly: the password is still set, and the server logs the email error.",
      copy(REPLY, start, end, whole(REPLY_PILLS))
    )
  }

  @Test
  fun `copies both pills when one selection holds a path pill and a code pill`() {
    val start = REPLY.indexOf("In the production")
    val end = REPLY.indexOf(". I haven't")
    assertEquals(
      "In the production setup (infra/lib/nexos-stack.ts), SES is switched off and Cloudflare " +
        "SMTP is configured, so SMTP is what sends it.\n\nOne catch: that SMTP setup comes from " +
        "PR #1129 and reaches production only when someone runs cdk deploy",
      copy(REPLY, start, end, whole(REPLY_PILLS))
    )
  }

  @Test
  fun `copies the whole reply with every pill once, and nothing else changed`() {
    val copied = copy(REPLY, 0, REPLY.length, whole(REPLY_PILLS))
    assertEquals(
      REPLY.replaceFirst("$P", REPLY_PILLS[0]).replaceFirst("$P", REPLY_PILLS[1]),
      copied
    )
  }

  @Test
  fun `copies a path split across two lines once, whole, with the space it was cut at`() {
    assertEquals(
      "•  Worktree: $PATH. Branch fix/chat-rows, commits 68a160e5 and 06b32d5e on top of main 4f46fd47.",
      copy(WORKTREE, 0, WORKTREE.length, WORKTREE_PILLS)
    )
  }

  @Test
  fun `copies the whole split path once when the selection starts on its second piece`() {
    val second = WORKTREE.indexOf("$P$P") + 1
    val branchEnd = WORKTREE.indexOf("Branch") + "Branch".length
    assertEquals("$PATH. Branch", copy(WORKTREE, second, branchEnd, WORKTREE_PILLS))
  }

  @Test
  fun `copies the whole split path once when the selection ends on its first piece`() {
    val first = WORKTREE.indexOf("$P$P")
    assertEquals(
      "Worktree: $PATH",
      copy(WORKTREE, WORKTREE.indexOf("Worktree"), first + 1, WORKTREE_PILLS)
    )
  }

  @Test
  fun `copies a span cut in three once, from any piece of it`() {
    val first = PROBES.indexOf(P)
    val pills = listOf(PillCopyText(0, PROBES_PATH), PillCopyText(1, PROBES_PATH), PillCopyText(2, PROBES_PATH))
    assertEquals("The review probes are in $PROBES_PATH. Copy them in.", copy(PROBES, 0, PROBES.length, pills))
    // The middle piece alone, and the last two.
    assertEquals(PROBES_PATH, copy(PROBES, first + 1, first + 2, pills))
    assertEquals("$PROBES_PATH.", copy(PROBES, first + 1, first + 4, pills))
  }

  @Test
  fun `copies the one pill a selection of just that pill holds`() {
    val at = REPLY.lastIndexOf(P)
    assertEquals("cdk deploy", copy(REPLY, at, at + 1, whole(REPLY_PILLS)))
    // A Text that is one pill and nothing else (a reply of `x`).
    assertEquals("x", copy("$P", 0, 1, whole(listOf("x"))))
  }

  @Test
  fun `copies two spans side by side each once, even with the same words`() {
    // "`a`**`b`**" and "`x`**`x`**": the bold pill follows with no character between.
    assertEquals("ab", copy("$P$P", 0, 2, whole(listOf("a", "b"))))
    assertEquals("xx", copy("$P$P", 0, 2, whole(listOf("x", "x"))))
  }

  @Test
  fun `copies a selection made backwards the same as forwards`() {
    val start = REPLY.indexOf("someone runs")
    val end = REPLY.indexOf(" I haven't")
    assertEquals("someone runs cdk deploy.", copy(REPLY, end, start, whole(REPLY_PILLS)))
  }

  @Test
  fun `keeps U+FFFC for a pill whose text cannot be read, and every word around it`() {
    val start = REPLY.indexOf("In the production")
    val end = REPLY.indexOf(". I haven't")
    val placeholders = placeholders(REPLY, listOf(null, PillCopyText(0, "cdk deploy")))
    assertEquals(
      "In the production setup ($P), SES is switched off and Cloudflare SMTP is configured, so " +
        "SMTP is what sends it.\n\nOne catch: that SMTP setup comes from PR #1129 and reaches " +
        "production only when someone runs cdk deploy",
      copyWithPills(REPLY, start, end, placeholders)
    )
    assertEquals(listOf(REPLY.indexOf(P)), planPillCopy(REPLY, start, end, placeholders).kept)
  }

  @Test
  fun `copies a later piece whose first piece could not be read, rather than drop the span`() {
    val pills = listOf(null, PillCopyText(1, PATH), null, null, null, null, null)
    assertEquals("Worktree: $P$PATH.", copy(WORKTREE, WORKTREE.indexOf("Worktree"), WORKTREE.indexOf(" Branch"), pills))
  }

  @Test
  fun `leaves a placeholder alone when its index does not hold U+FFFC`() {
    val text = "runs x."
    val placeholders = listOf(InlinePlaceholder(5, PillCopyText(0, "cdk deploy")))
    assertEquals("runs x.", copyWithPills(text, 0, text.length, placeholders))
    assertEquals(listOf(5), planPillCopy(text, 0, text.length, placeholders).kept)
  }

  @Test
  fun `leaves a U+FFFC that is not an inline View as it is`() {
    // A reply can quote the character itself; only a placeholder span makes it a pill.
    val text = "a $P b $P c"
    val placeholders = listOf(InlinePlaceholder(text.lastIndexOf(P), PillCopyText(0, "pill")))
    assertEquals("a $P b pill c", copyWithPills(text, 0, text.length, placeholders))
  }

  @Test
  fun `copies a Text with no pills exactly as it reads`() {
    val text = "Plain words, no pill at all."
    assertEquals(text.substring(6, 11), copyWithPills(text, 6, 11, emptyList()))
    val plan = planPillCopy(text, 0, text.length, emptyList())
    assertEquals(emptyList<Pair<Int, String>>(), plan.replacements)
    assertEquals(emptyList<Int>(), plan.kept)
  }

  @Test
  fun `copies nothing from an empty selection, and clamps one past the end`() {
    assertEquals("", copy(REPLY, 10, 10, whole(REPLY_PILLS)))
    assertEquals("", copy("", 0, 0, emptyList()))
    val at = REPLY.lastIndexOf(P)
    assertEquals(
      "cdk deploy" + REPLY.substring(at + 1),
      copy(REPLY, at, REPLY.length + 5, whole(REPLY_PILLS))
    )
    assertEquals(
      emptyList<Pair<Int, String>>(),
      planPillCopy(REPLY, at, at, placeholders(REPLY, whole(REPLY_PILLS))).replacements
    )
  }

  @Test
  fun `reads the nativeID the JS side writes, and nothing near it`() {
    // markdown-pill-copy-id.test.ts pins the same strings from the writing side.
    assertEquals(PillCopyText(0, "cdk deploy"), PillCopyText.fromNativeId("codeui-pill:0:cdk deploy"))
    assertEquals(PillCopyText(12, "a:b c"), PillCopyText.fromNativeId("codeui-pill:12:a:b c"))
    for (bad in listOf(
      null,
      "",
      "cdk deploy",
      "codeui-pill:",
      "codeui-pill:1",
      "codeui-pill::x",
      "codeui-pill:x:y",
      "codeui-pill:-1:y",
      "codeui-pill:+1:y",
      "codeui-pill:99999999999:y",
      "codeui-pill:0:",
      " codeui-pill:0:x"
    )) {
      assertNull("nativeID ${bad?.let { "\"$it\"" }}", PillCopyText.fromNativeId(bad))
    }
  }
}
