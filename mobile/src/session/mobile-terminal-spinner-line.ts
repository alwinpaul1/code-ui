// ─── Claude Code's spinner line, for the chat's status line ──────────────────
//
// While it works Claude Code paints one line above its input box:
//
//   ✻ Frolicking… (15m 36s · ↓ 56.6k tokens)
//   ✢ Thinking… (21s · ↓ 172 tokens)
//
// (real screens, fixtures in mobile-terminal-hud-parse.test.ts). The
// parenthesis holds its parts joined by " · ": the elapsed time once the turn
// is past 16 s, the token count, and a thinking status. The thinking words are
// read out of the Claude Code 2.1.281 bundle (`Oo()` and `Ao()` beside the
// spinner): "thinking", "still thinking", "thinking more", "thinking some
// more", "deep in thought", "thought for 3s". 2.1.283 has the same words,
// thresholds and 16 s cut (`Lo()` and `Eo()` there, read 2026-09-26). The
// Claude app draws the same three facts on its own status line, "✳ 1m 16s ·
// 5 running tasks · thinking some more…" (recordings of 2026-09-24), with the
// verb, "Cooking…", until an elapsed time is showing.
//
// A compaction paints "Compacting conversation…", two words, which this does
// not read, on 2.1.282 and 2.1.283 alike. 2.1.283 adds the compaction's own
// time and token count to that line where 2.1.282 drew a bar under it.
//
// Codex paints "• Working (5s • esc to interrupt)", which this does not read:
// the glyph and separator differ, and a Codex tab falls back to "Working".

export type ClaudeSpinner = {
  /** The spinner's verb, "Frolicking". */
  verb: string
  /** "15m 36s", when the line shows one. */
  elapsed: string | null
  /** One of Claude Code's thinking statuses, when the line shows one. */
  thinking: string | null
}

const SPINNER_LINE = /^\s*[✳✻✽✶✢·*⏺]\s+([A-Z][a-zA-Z]+)…(?:\s*\(([^)]*)\)?)?/
const ELAPSED = /^(?:\d+h\s*)?(?:\d+m\s*)?\d+s$|^\d+h\s*\d+m$|^\d+m$/
const THINKING = /^(?:thinking|still thinking|thinking more|thinking some more|deep in thought|almost done thinking|thought for \d+s)$/

/** The live spinner, read from the bottom of the screen up, or null when
 *  none is painted. */
export function parseClaudeSpinnerLine(lines: readonly string[]): ClaudeSpinner | null {
  for (let index = lines.length - 1; index >= Math.max(0, lines.length - 12); index -= 1) {
    const match = SPINNER_LINE.exec(lines[index] ?? '')
    if (!match) {
      continue
    }
    const parts = (match[2] ?? '').split(/\s+·\s+/).map((part) => part.trim())
    return {
      verb: match[1]!,
      elapsed: parts.find((part) => ELAPSED.test(part)) ?? null,
      thinking: parts.find((part) => THINKING.test(part)) ?? null
    }
  }
  return null
}

export function sameSpinner(left: ClaudeSpinner | null, right: ClaudeSpinner | null): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.verb === right.verb &&
      left.elapsed === right.elapsed &&
      left.thinking === right.thinking)
  )
}
