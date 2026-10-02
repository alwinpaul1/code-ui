import { hasCodexFooter } from './mobile-terminal-hud-parse'

/** Codex's own input row: `›` at column 0, then a space (or nothing, once a
 *  reader trims it). A sent prompt, a popup's selected row and an approval's
 *  selected option wear the same glyph, so it is only the START of the proof. */
const COMPOSER_ROW = /^›(?: |$)/
/** The footer when Codex draws no model or directory (the default hint row, or
 *  a `tui.status_line` holding the context item): "tab to queue message   100%
 *  context left". MODELLED from rust-v0.158.0 snapshots, not a capture. */
const CONTEXT_LEFT_FOOTER = /^ {2}\S.*\b\d{1,3}% context left\s*$/
const INDENTED = /^ {2}\S/

/** A real footer is indented two columns; `hasCodexFooter`'s own pattern also
 *  takes column 0, where a shell prompt like `x-y · ~/proj` would match. */
const isFooterRow = (row: string): boolean =>
  INDENTED.test(row) && (hasCodexFooter([row]) || CONTEXT_LEFT_FOOTER.test(row))

/**
 * Whether Codex's composer is up, as far as a screen can show: the last `›` row
 * at column 0 (the composer's, or its only candidate), then rows indented two
 * columns (its wrapped draft, a popup under it) up to a footer row, and under
 * the footer nothing at column 0. The footer is the proof: a shell, an approval
 * and the trust prompt draw none under a `›` row.
 *
 * Codex 0.155.1 and 0.158.0 screens of an idle or working composer, real and
 * with Orca's blank rows dropped, all pass (fixtures/codex-composer-screens.ts
 * says which are real). Codex 0.153.4 has no composer capture here. What a
 * shell shows after Codex exits is NOT captured: a prompt or Codex's exit lines
 * under the old frame are modelled as column-0 rows and refuse; an exit that
 * leaves the frame with nothing drawn under it passes, as it does for Claude
 * (claudeComposerLive). A footer cut by a narrow pane (no `·` item) is not
 * known to read.
 */
export function codexComposerLive(lines: readonly string[]): boolean {
  const composer = lines.findLastIndex((row) => COMPOSER_ROW.test(row))
  if (composer === -1) {
    return false
  }
  const rest = lines.slice(composer + 1).filter((row) => row.trim() !== '')
  const footer = rest.findIndex(isFooterRow)
  return (
    footer !== -1 &&
    rest.slice(0, footer).every((row) => row.startsWith('  ')) &&
    rest.slice(footer + 1).every((row) => row.startsWith('  '))
  )
}
