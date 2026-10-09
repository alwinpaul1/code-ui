import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyAgentHudBeaconFields } from './hud-beacon-fields'
import { parseTerminalHudObservation } from './mobile-terminal-hud-parse'
import { sessionModelPillLabel } from './session-model-pill'

// Device report 2026-10-09 (build 0.9.117): a hand-typed Claude Code 2.1.295 tab, fullscreen, macOS
// host, 126-column pane, showed the pill "Opus 5.5" with no effort and no ring, while the user's
// usage-band mod painted `Opus 5.5 xhigh │ ◔ ━━━━━╸━━ 68% 680.7k/1.0M` right above the input box.
//
// Real screens: Orca's own screen read (`orca terminal read --screen --json`, the RPC family the
// phone reads with) against the user's live tabs on 2026-10-09, Claude Code 2.1.295. Project names
// and people were swapped for neutral words of the same length; every glyph, width and space is the
// pane's. On these screens the band has no blank rows around it, and no spinner or turn-end row is
// in reach above it: an agent's "finished" notice (`⏺ Agent "…" finished · 10m 28s`) sits right
// above the `[-]` row. The reader refused everything above the box unless a turn row bounded it.
//
// The subagent row (`↳ general-purpose · Opus 5.5 medium │ ◔ 14% …`) is the band the mod draws while
// the user views a subagent's transcript (usage-band `agentContextSpec`, which REPLACES the main
// pill); taken from the stream read of such a tab, pill caps included.

function readCapture(file: string): string[] {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)), 'utf8').split('\n')
}

const AGENT_FINISHED = readCapture('claude-usage-band-fullscreen-126-agent-finished-2.1.295.txt')
const WAITING = readCapture('claude-usage-band-fullscreen-126-waiting-2.1.295.txt')

const BAND_ROW = /^  Opus 5\.5 xhigh │/
const GIT_ROW = /^   /
const MARKER_ROW = /^\s+\[-\]$/
const RULE = /^─+$/

const SUBAGENT_ROW =
  '  ↳ general-purpose · Opus 5.5 medium │ ◔ 14%   ◷ 5h 7% │ 12:19 PM   ▦ 7d 23% │ Wed 6:59 PM '
/** The same pill in the mod's full form, where the pane is wide enough for the token figure. */
const SUBAGENT_ROW_WITH_FIGURE =
  '  ↳ general-purpose · Opus 5.5 medium │ ◔ ━╸━━━━━━ 14% 140.2k/1.0M   ◷ 5h ╸━━━━━━━ 5% │ 10:20 PM '

function replaceRow(lines: readonly string[], match: RegExp, row: string): string[] {
  const index = lines.findLastIndex((line) => match.test(line))
  expect(index).toBeGreaterThan(-1)
  return lines.map((line, at) => (at === index ? row : line))
}

function withoutRows(lines: readonly string[], ...matches: RegExp[]): string[] {
  return lines.filter((line) => !matches.some((match) => match.test(line)))
}

/** `rows` put directly above the box's top rule (the first rule from the bottom but one). */
function aboveBox(lines: readonly string[], rows: string[]): string[] {
  const input = lines.findLastIndex((line) => line.startsWith('❯'))
  const top = input - 1
  expect(RULE.test(lines[top] ?? '')).toBe(true)
  return [...lines.slice(0, top), ...rows, ...lines.slice(top)]
}

const observe = (lines: readonly string[]) => parseTerminalHudObservation(lines)

describe('the band above the box with no turn row in reach', () => {
  it("shows the ring when an agent's finished notice sits right above the band", () => {
    expect(observe(AGENT_FINISHED)?.context).toEqual({
      usedPercent: 68,
      usedLabel: '680.7k',
      windowLabel: '1.0M'
    })
  })

  it('shows the model and effort the band names beside the ring', () => {
    const read = observe(AGENT_FINISHED)
    expect(read).toMatchObject({ modelLabel: 'Opus 5.5', modelId: 'opus', effort: 'xhigh' })
    // Drawn as a claude-hud badge's pair is: the Claude app's name for xhigh.
    expect(sessionModelPillLabel({ model: read!.modelId, label: read!.modelLabel, effort: read!.effort })).toBe(
      'Opus 5.5 Extra'
    )
    expect(observe(WAITING)).toMatchObject({
      modelLabel: 'Opus 5.5',
      modelId: 'opus',
      effort: 'medium',
      context: { usedPercent: 42, usedLabel: '415.3k', windowLabel: '1.0M' }
    })
  })

  it('reads the band with no footer row on screen: the input box is all it needs', () => {
    // A hand-typed tab has no beacon, and the screen poll reads this screen as it is; a footer row
    // the screen happens not to show (a repaint, a mode with none) must not hide the band.
    const noFooter = withoutRows(WAITING, /⏵⏵ auto mode on/)
    expect(observe(noFooter)).toMatchObject({
      modelLabel: 'Opus 5.5',
      effort: 'medium',
      context: { usedPercent: 42 },
      permissionModeSeen: null
    })
  })

  it('reads the band at the top of the screen, nothing above it', () => {
    const from = AGENT_FINISHED.findIndex((line) => MARKER_ROW.test(line))
    expect(observe(AGENT_FINISHED.slice(from))).toMatchObject({ effort: 'xhigh', context: { usedPercent: 68 } })
  })

  it('reads a model with no effort as the model alone', () => {
    const noEffort = replaceRow(
      AGENT_FINISHED,
      BAND_ROW,
      '  Haiku 4.5 │ ◔ ━━━━━╸━━ 68% 680.7k/1.0M   ◷ 5h ╸━━━━━━━ 5% │ 10:20 PM '
    )
    expect(observe(noEffort)).toMatchObject({ modelLabel: 'Haiku 4.5', modelId: 'haiku', effort: null })
  })
})

describe('what the band reader still refuses', () => {
  it("refuses an answer's continuation with the band's shape right above the box", () => {
    // The band gone, and an answer's last row ("  Opus 5.5 high │ ◔ 12% 120.0k/1.0M", the shape a
    // reply quoting the band has; claude-usage-band-fullscreen-160-quoted-continuation-2.1.295.txt)
    // directly on the box's top rule, with no blank row and no turn row.
    const noBand = withoutRows(AGENT_FINISHED, BAND_ROW, GIT_ROW, MARKER_ROW)
    const quoted = aboveBox(noBand, ['  Opus 5.5 high │ ◔ 12% 120.0k/1.0M'])
    expect(observe(quoted)).toMatchObject({ modelId: null, effort: null, context: null })
    // With the `[-]` row between them, too.
    const marked = aboveBox(noBand, [
      AGENT_FINISHED.find((line) => MARKER_ROW.test(line))!,
      '  Opus 5.5 high │ ◔ 12% 120.0k/1.0M'
    ])
    expect(observe(marked)).toMatchObject({ modelId: null, effort: null, context: null })
  })

  it('stops at the conversation: a band-shaped row above an answer is not read', () => {
    // The pill row kept, but an answer row between it and the box: the block ends at the answer.
    const band = AGENT_FINISHED.find((line) => BAND_ROW.test(line))!
    const noBand = withoutRows(AGENT_FINISHED, BAND_ROW, GIT_ROW, MARKER_ROW)
    const split = aboveBox(noBand, [band, '⏺ Done.'])
    expect(observe(split)).toMatchObject({ modelId: null, context: null })
  })

  it.each([
    ['without a figure', SUBAGENT_ROW],
    ['with a figure', SUBAGENT_ROW_WITH_FIGURE]
  ])("refuses the subagent view's band (%s) for the main session", (_name, row) => {
    expect(observe(replaceRow(AGENT_FINISHED, BAND_ROW, row))).toMatchObject({
      modelId: null,
      effort: null,
      context: null
    })
    // Under Claude Code's own turn row ("✻ Waiting for 2 background agents to finish") as well.
    expect(observe(replaceRow(WAITING, /^  Opus 5\.5 medium │/, row))).toMatchObject({
      modelId: null,
      effort: null,
      context: null
    })
  })

  it('refuses an effort word it does not know', () => {
    const unknown = replaceRow(
      AGENT_FINISHED,
      BAND_ROW,
      '  Opus 5.5 turbo │ ◔ ━━━━━╸━━ 68% 680.7k/1.0M   ◷ 5h ╸━━━━━━━ 5% │ 10:20 PM '
    )
    expect(observe(unknown)).toMatchObject({ modelId: null, effort: null })
    // The figure on it is still the session's own.
    expect(observe(unknown)?.context?.usedPercent).toBe(68)
  })

  it('refuses two model pairs', () => {
    const two = replaceRow(AGENT_FINISHED, /cache ● 1h/, '  Sonnet 5.5 high │ main')
    expect(observe(two)).toMatchObject({ modelId: null, effort: null })
  })

  it('the beacon still wins the ring; the band owns the pair, as the badge does', () => {
    const merged = applyAgentHudBeaconFields(observe(AGENT_FINISHED), {
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
    expect(merged).toMatchObject({ modelLabel: 'Opus 5.5', effort: 'xhigh' })
  })
})
