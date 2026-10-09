import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseTerminalHudObservation } from './mobile-terminal-hud-parse'

// A `claude` typed by hand into an Orca terminal has no beacon and, on a host with no status line of
// its own, no badge, so Claude Code's own low-context warning is the only context figure the phone
// can honestly show for it (docs/mobile-agent-hud.md, "The ring for a hand-started session",
// 2026-10-09). In FULLSCREEN Claude Code 2.1.295 paints that warning right-aligned on the row
// directly above the input box's top rule, flush with the box's right edge two columns in, where the
// reader skipped every indented row as conversation, so the ring never appeared.
//
// Real screens, tmux capture-pane against a live Claude Code 2.1.295 on 2026-10-09, user settings
// skipped (`--setting-sources project`, so no status line and no hooks), fullscreen set for that
// process only (`--settings '{"tui":"fullscreen"}'`), and the warning brought forward with session
// env only: `DISABLE_COMPACT=1 CLAUDE_CODE_MAX_CONTEXT_TOKENS=90000` for "Context low",
// `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=7.5` for "until auto-compact". Nothing was saved.

function readCapture(file: string): string[] {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)), 'utf8').split('\n')
}

const FULLSCREEN_LOW = readCapture('claude-fullscreen-context-low-2.1.295.txt')
const FULLSCREEN_LOW_44 = readCapture('claude-fullscreen-context-low-44col-2.1.295.txt')
const FULLSCREEN_COMPACT = readCapture('claude-fullscreen-until-auto-compact-2.1.295.txt')
// The default layout draws inline, and this capture was a fresh session, so 21 empty rows sit under
// its footer. Claude Code paints the warning only near a full context, when scrollback has long since
// pushed the footer to the bottom of the screen, so the rows are read as they would be then.
const DEFAULT_LOW_RAW = readCapture('claude-default-context-low-2.1.295.txt')
const DEFAULT_LOW = DEFAULT_LOW_RAW.slice(0, DEFAULT_LOW_RAW.findLastIndex((line) => line.trim() !== '') + 1)

/** The capture with its warning row replaced. */
function withWarningRow(lines: string[], row: string): string[] {
  return lines.map((line) => (/Context low|until auto-compact/.test(line) ? row : line))
}

describe("Claude Code's own context warning in fullscreen shows the ring", () => {
  it('shows the ring from "Context low" painted above the box in fullscreen at desktop width', () => {
    expect(parseTerminalHudObservation(FULLSCREEN_LOW)?.context).toEqual({
      usedPercent: 78,
      usedLabel: null,
      windowLabel: null
    })
  })

  it('shows the ring from "Context low" painted above the box in fullscreen at 44 columns', () => {
    expect(parseTerminalHudObservation(FULLSCREEN_LOW_44)?.context?.usedPercent).toBe(78)
  })

  it('shows the ring from "% until auto-compact" painted above the box in fullscreen', () => {
    expect(parseTerminalHudObservation(FULLSCREEN_COMPACT)?.context?.usedPercent).toBe(75)
  })

  it('still shows the ring from the warning on the footer row in the default layout', () => {
    expect(parseTerminalHudObservation(DEFAULT_LOW)?.context?.usedPercent).toBe(78)
  })

  it('keeps the mode and leaves the model blank: the warning names no model', () => {
    expect(parseTerminalHudObservation(FULLSCREEN_LOW)).toMatchObject({
      modelLabel: '',
      modelId: null,
      permissionModeSeen: 'auto'
    })
  })

  it('shows no ring for an answer quoting the warning two columns in, right above the box', () => {
    const quoted = withWarningRow(FULLSCREEN_LOW, '  Context low (22% remaining)')
    expect(parseTerminalHudObservation(quoted)?.context).toBeNull()
  })

  it('shows no ring for an indented row above the box that is not flush with its right edge', () => {
    const notFlush = withWarningRow(FULLSCREEN_LOW, `${' '.repeat(40)}Context low (22% remaining)`)
    expect(parseTerminalHudObservation(notFlush)?.context).toBeNull()
  })

  it('shows no ring for a figure in a status-line shape on the fullscreen notice row', () => {
    // Only Claude Code's own wording is read there, never "ctx 54%" or a bare percent.
    const row = FULLSCREEN_LOW.find((line) => line.includes('Context low'))!
    const shape = 'ctx 54% 537.2k/1M'
    const swapped = withWarningRow(FULLSCREEN_LOW, `${' '.repeat(row.length - shape.length)}${shape}`)
    expect(parseTerminalHudObservation(swapped)?.context).toBeNull()
  })

  it('shows no ring for a flush tool-output row that quotes the warning after other text', () => {
    // Review, 2026-10-09: a `⎿` continuation row, flush at the box's edge by chance, quoting it.
    const row = FULLSCREEN_LOW_44.find((line) => line.includes('Context low'))!
    const quote = `${'x'.repeat(10)}Context low (22% remaining)`
    const quoted = withWarningRow(FULLSCREEN_LOW_44, `${' '.repeat(row.length - quote.length)}${quote}`)
    expect(parseTerminalHudObservation(quoted)?.context).toBeNull()
  })

  it('reads the notice row when it is the first row on screen (nothing above it)', () => {
    const at = FULLSCREEN_LOW.findIndex((line) => line.includes('Context low'))
    expect(parseTerminalHudObservation(FULLSCREEN_LOW.slice(at))?.context?.usedPercent).toBe(78)
  })

  it('shows no ring when the screen is only the box and its footer, no notice row', () => {
    const at = FULLSCREEN_LOW.findIndex((line) => line.includes('Context low'))
    expect(parseTerminalHudObservation(FULLSCREEN_LOW.slice(at + 1))?.context).toBeNull()
  })
})
