import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyAgentHudBeaconFields } from './hud-beacon-fields'
import { parseTerminalHudObservation } from './mobile-terminal-hud-parse'

// The ring from a `<used>/<window>` figure the user's OWN status-line painting puts on screen, for a
// Claude session with no beacon (typed by hand, fullscreen or default, any host). The user approved
// reading it on 2026-10-09 (docs/mobile-agent-hud.md, "The user's own status-line figure").
//
// Real screens: tmux capture-pane against a live Claude Code 2.1.295 on 2026-10-09, in a private tmux
// server, with this user's real settings (status line `~/.claude/mods/usage-band/bin/statusline.sh`
// and the usage-band mod). Fullscreen is the user's saved default; the default layout was set for the
// process only (`--settings '{"tui":"default"}'`). Nothing was saved. Captured at 160, 100 and 44
// columns. On this host the figure row (`Opus 5.5 medium │ ◔ ╸━━━━━━━ 7% 68.3k/1.0M   ◷ 5h …`) is
// drawn by the mod ABOVE the input box; the status line command itself prints only the `cache` row
// under it (claude-usage-band-statusline-output-2.1.295.txt). At 100 columns and below the mod drops
// the token figure and keeps `◔ 7%`, which states no window.

function readCapture(file: string): string[] {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)), 'utf8').split('\n')
}

const FULLSCREEN_160 = readCapture('claude-usage-band-fullscreen-160-2.1.295.txt')
const DEFAULT_160 = readCapture('claude-usage-band-default-160-2.1.295.txt')
const FULLSCREEN_160_CONTINUATION = readCapture('claude-usage-band-fullscreen-160-quoted-continuation-2.1.295.txt')
const FULLSCREEN_160_WORKING = readCapture('claude-usage-band-fullscreen-160-working-2.1.295.txt')
const DEFAULT_160_WORKING = readCapture('claude-usage-band-default-160-working-2.1.295.txt')
const FULLSCREEN_100 = readCapture('claude-usage-band-fullscreen-100-2.1.295.txt')
const FULLSCREEN_44 = readCapture('claude-usage-band-fullscreen-44-2.1.295.txt')
const DEFAULT_44 = readCapture('claude-usage-band-default-44-2.1.295.txt')

const BAND_ROW = /◔ ╸━━━━━━━ 7% 6[89]\.\dk\/1\.0M/

function contextOf(lines: readonly string[]) {
  return parseTerminalHudObservation(lines)?.context ?? null
}

/** The capture with the LAST row matching `match` replaced: the live rows are the lowest. */
function replaceRow(lines: readonly string[], match: RegExp, row: string): string[] {
  const index = lines.findLastIndex((line) => match.test(line))
  expect(index).toBeGreaterThan(-1)
  return lines.map((line, at) => (at === index ? row : line))
}

describe("the ring from the user's own status line", () => {
  it("shows the ring from the user's own status line on a hand-typed fullscreen tab", () => {
    expect(contextOf(FULLSCREEN_160)).toEqual({ usedPercent: 7, usedLabel: '68.3k', windowLabel: '1.0M' })
  })

  it("shows the ring from the user's own status line in the default layout", () => {
    expect(contextOf(DEFAULT_160)).toEqual({ usedPercent: 7, usedLabel: '68.3k', windowLabel: '1.0M' })
  })

  it('shows the ring while Claude works, under its spinner and tip rows', () => {
    expect(contextOf(FULLSCREEN_160_WORKING)).toEqual({ usedPercent: 7, usedLabel: '69.0k', windowLabel: '1.0M' })
    expect(contextOf(DEFAULT_160_WORKING)).toEqual({ usedPercent: 7, usedLabel: '68.9k', windowLabel: '1.0M' })
  })

  it("reads another user's status line that prints the figure under the box", () => {
    const lines = replaceRow(DEFAULT_160, /cache ● 1h/, '  Sonnet 5.5 · 54.2k/200k (27%) · main')
    const withoutBand = replaceRow(lines, BAND_ROW, '')
    expect(contextOf(withoutBand)).toEqual({ usedPercent: 27, usedLabel: '54.2k', windowLabel: '200k' })
  })

  it("takes the percent from the used/window figure when the row paints none", () => {
    const lines = replaceRow(DEFAULT_160, /cache ● 1h/, '  ctx 150k/200k')
    expect(contextOf(replaceRow(lines, BAND_ROW, ''))).toEqual({
      usedPercent: 75,
      usedLabel: '150k',
      windowLabel: '200k'
    })
  })
})

describe('what is refused', () => {
  it('ignores a token figure quoted in conversation above the box', () => {
    // The answer's continuation row "  Opus 5.5 high │ ◔ 12% 120.0k/1.0M" is the band's exact shape;
    // it sits above Claude's own "✻ … done" row, so it is conversation.
    expect(contextOf(FULLSCREEN_160_CONTINUATION)?.usedLabel).toBe('68.8k')
    expect(contextOf(replaceRow(FULLSCREEN_160_CONTINUATION, BAND_ROW, ''))).toBeNull()
    expect(contextOf(replaceRow(FULLSCREEN_160, BAND_ROW, ''))).toBeNull()
  })

  it('refuses the rows above the box when nothing Claude paints separates them from the conversation', () => {
    const noTurnEnd = replaceRow(FULLSCREEN_160_CONTINUATION, /^✻ .* · done /, '')
    expect(contextOf(noTurnEnd)).toBeNull()
    // With only the quoted figure left, nothing but the missing turn row stops it being read.
    expect(contextOf(replaceRow(noTurnEnd, BAND_ROW, ''))).toBeNull()
    // The band at the top of the screen, nothing above it: no turn row in reach either.
    const fromBand = FULLSCREEN_160.slice(FULLSCREEN_160.findLastIndex((line) => BAND_ROW.test(line)))
    expect(contextOf(fromBand)).toBeNull()
  })

  it('ignores rate-limit percents', () => {
    // The mod's narrow forms: `◔ 7%` beside `◷ 5h 6%` and `▦ 7d 24%`, with no token figure.
    expect(contextOf(FULLSCREEN_100)).toBeNull()
    expect(contextOf(FULLSCREEN_44)).toBeNull()
    expect(contextOf(DEFAULT_44)).toBeNull()
    const rateLimitOnFigure = replaceRow(
      replaceRow(DEFAULT_160, BAND_ROW, ''),
      /cache ● 1h/,
      '  $0.42 │ 5h 12% 120k/1.0M │ 7d 30%'
    )
    expect(contextOf(rateLimitOnFigure)).toBeNull()
  })

  it('refuses a percent that disagrees with the figure beside it', () => {
    expect(contextOf(replaceRow(FULLSCREEN_160, BAND_ROW, '  Opus 5.5 medium │ ◔ ╸━━━━━━━ 40% 68.3k/1.0M'))).toBeNull()
  })

  it('refuses two figures', () => {
    const twoRows = replaceRow(FULLSCREEN_160, /cache ● 1h/, '  ↳ general-purpose · Sonnet 5.5 │ ◔ 3% 6.1k/200k')
    expect(contextOf(twoRows)).toBeNull()
    const oneRow = replaceRow(
      FULLSCREEN_160,
      BAND_ROW,
      '  Opus 5.5 medium │ ◔ 7% 68.3k/1.0M   ↳ Explore │ ◔ 3% 6.1k/200k'
    )
    expect(contextOf(oneRow)).toBeNull()
  })

  it('refuses a figure the row cut or wrapped', () => {
    const rule = '─'.repeat(44)
    const marker = '✻ Worked for 10s · done 12:57 PM'
    const footer = '  ⏵⏵ auto mode on (shift+tab to cycle) · …'
    // A 44-column row that ends mid-figure, its tail wrapped onto the next row with the painter's
    // two-column indent (as Claude Code wraps its own rows, "⚠ Your login expires … /login" then
    // "  to renew" in the 44-column captures): the tail alone has the shape ("8.3k/1.0M"), and the
    // row before it fills the pane, so it is a continuation.
    const head = '  Opus 5.5 medium │ ◔ 7% 6'
    const filled = `${head.slice(0, 2)}${' '.repeat(44 - Array.from(head).length)}${head.slice(2)}`
    expect(Array.from(filled).length).toBe(44)
    expect(contextOf([marker, filled, '  8.3k/1.0M', rule, '❯ ', rule, footer])).toBeNull()
    // A whole figure on a row that fills the pane may continue on the next: "68.3k/1.0M" + "5"?
    const full = '  Opus 5.5 medium │ ◔ 7% 68.3k/1.0M'
    const fullWidth = `${full.slice(0, 2)}${' '.repeat(44 - Array.from(full).length)}${full.slice(2)}`
    expect(contextOf([marker, fullWidth, '  0', rule, '❯ ', rule, footer])).toBeNull()
    // Cut by the painter.
    expect(contextOf([marker, '  Opus 5.5 │ ◔ 7% 68.3k/1.0M…', rule, '❯ ', rule, footer])).toBeNull()
    // The same row whole and short is read, so the refusals above are about the cut, not the row.
    expect(contextOf([marker, full, rule, '❯ ', rule, footer])?.usedPercent).toBe(7)
  })

  it('reads nothing off an empty screen, a lone row, or a row with no box', () => {
    expect(contextOf([])).toBeNull()
    expect(contextOf([''])).toBeNull()
    const band = FULLSCREEN_160.find((line) => BAND_ROW.test(line))!
    expect(contextOf([band])).toBeNull()
    expect(contextOf(['✻ Worked for 10s · done 12:57 PM', band])).toBeNull()
  })
})

describe('where the figure sits among the other sources', () => {
  it("prefers the user's figure over Claude Code's own low-context warning", () => {
    const warned = replaceRow(DEFAULT_160, /cache ● 1h/, `  cache ● 1h${' '.repeat(100)}Context low (22% remaining)`)
    expect(contextOf(warned)?.usedPercent).toBe(7)
  })

  it('the beacon still wins over the screen figure', () => {
    const merged = applyAgentHudBeaconFields(parseTerminalHudObservation(FULLSCREEN_160), {
      agent: 'claude',
      sessionId: '77954fea-1013-4225-b187-a8b3162a04ce',
      modelId: 'claude-opus-5-5',
      modelLabel: 'Opus 5.5',
      effort: 'medium',
      usedTokens: 300_000,
      windowTokens: 1_000_000,
      usedPercent: 30,
      limits: [],
      doneTaskIds: [],
      runningTaskIds: null,
      runningTaskIdsAt: null,
      promptHook: false,
      desktopPrompt: null,
      desktopPrompts: [],
      launchedTaskIds: [],
      heartbeatSeconds: null,
      receivedAt: 0
    })
    expect(merged?.context?.usedPercent).toBe(30)
  })

  it('leaves the model to the beacon: the figure names none', () => {
    expect(parseTerminalHudObservation(FULLSCREEN_160)).toMatchObject({
      modelLabel: '',
      modelId: null,
      effort: null,
      permissionModeSeen: 'auto'
    })
  })

  it('leaves Codex alone: a figure in its conversation sets no ring', () => {
    const codex = [
      '• Opus 5.5 high │ ◔ 12% 120.0k/1.0M',
      '  ctx 150k/200k',
      '',
      '› Ask Codex to do anything',
      '  gpt-5.6-terra xhigh · ~/Desktop/Project/Code UI'
    ]
    expect(parseTerminalHudObservation(codex)).toMatchObject({ modelId: 'gpt-5.6-terra', context: null })
  })
})
