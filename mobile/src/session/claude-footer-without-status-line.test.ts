import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseAgentHudBeaconPayload, type AgentHudBeacon } from './agent-hud-beacon'
import { applyAgentHudBeaconFields } from './hud-beacon-fields'
import {
  parseCodexHudObservation,
  parseTerminalHudObservation,
  type TerminalPermissionMode
} from './mobile-terminal-hud-parse'
import { shownPermissionMode, stepTerminalMode } from './terminal-mode-stepper'

// A Claude host with no status line of its own paints no `[Model effort]`
// badge, and the parser returned nothing for it unless Claude Code's own
// low-context warning was up. So on every such host the permission mode and
// the footer's shell count were never read: the mode stepper saw null on
// every read, pressed Shift+Tab six times, left the desktop agent in whatever
// mode it landed on, and said "That mode is not available in this session";
// and with a beacon the pill said Manual over an accept-edits footer
// (review, 2026-09-30).
//
// Every screen here is a capture with claude-hud's rows taken out, because
// that is the one difference a bare host paints: Claude Code draws the same
// composer and footer, and nothing between them.

function readCapture(file: string): string[] {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)), 'utf8').split('\n')
}

/** The capture as a host with no status line paints it: the composer's
 *  closing rule, then the footer row, with claude-hud's rows between them gone. */
function withoutStatusLine(screen: readonly string[]): string[] {
  let end = screen.length - 1
  while (end > 0 && (screen[end] ?? '').trim() === '') {
    end -= 1
  }
  let rule = end
  while (rule > 0 && !/^─+$/.test(screen[rule] ?? '')) {
    rule -= 1
  }
  return [...screen.slice(0, rule + 1), screen[end]!]
}

const NBSP = ' '
const RULE_100 = '─'.repeat(100)
const RULE_80 = '─'.repeat(80)
// Claude Code 2.1.270, `tmux capture-pane -p` on 2026-09-13, 100 columns
// (mobile-terminal-sent-prompts.test.ts), in manual mode: the footer row has
// no "shift+tab to cycle" hint.
const MANUAL_2_1_270 = withoutStatusLine([
  '⏺ done',
  '',
  '✻ Baked for 7s · done 10:25 AM',
  '',
  RULE_100,
  `❯${NBSP}`,
  RULE_100,
  '  [Haiku 4.5 | Max 20x] ██░░░░ 26% (52k/200k) | probe | 1 CLAUDE.md | 4 rules | 3 MCPs | 12 hooks',
  '  Usage ░░░░░░ 6% (resets 3:10 PM) | Weekly ███░░░ 46% (resets Wed 7:00 PM)',
  '  ───────────────────────────────────────────────────────────────────────────────────────────────',
  '  ✓ Bash ×1',
  '  ⏸ manual mode on · ← for agents'
])
// Claude Code 2.1.281 idle, tmux (claude-screen-sent-photos-2.1.281.txt): the
// whole hint is painted.
const AUTO_2_1_281 = withoutStatusLine(readCapture('claude-screen-sent-photos-2.1.281.txt'))
// Claude Code 2.1.278 at 46 columns, tmux (claude-screen-peer-message-2.1.278.txt):
// the hint cut short.
const BYPASS_2_1_278 = withoutStatusLine(readCapture('claude-screen-peer-message-2.1.278.txt'))
// Claude Code 2.1.277 with a shell running, `orca terminal read --screen`
// 2026-09-19 (mobile-terminal-queued-messages.test.ts).
const SHELL_2_1_277 = withoutStatusLine([
  '✻ Frolicking… (15m 36s · ↓ 56.6k tokens)',
  RULE_80,
  '❯',
  RULE_80,
  '  [Opus 5 (1M context) xhigh | Max 20x] ██░░░░ 28% (275k/1.0M)',
  '  Usage ░░░░░░ 7% (resets 1:20 AM) | Weekly ██░░░░ 38% (resets Wed 7:00 PM)',
  '  ─────────────────────────────────────────────────────────────────────────',
  '  ✓ Bash ×19 | ✓ Skill ×1',
  '  ⏵⏵ auto mode on · 1 shell · ← for agents'
])
// The footer a screen showed on 2026-09-14 with four shells running
// (mobile-terminal-hud-parse.ts), under the 2.1.277 composer.
const SHELLS_2026_09_14 = [RULE_80, '❯', RULE_80, '▶▶ auto mode on · 4 shells · ← for agents']
// The accept-edits footer of a hand-started claude, terminal.read 2026-09-18
// (use-mobile-native-chat-hud.test.ts), under the 2.1.281 composer.
const ACCEPT_EDITS_2026_09_18 = [RULE_100, '❯ ', RULE_100, '  ⏵⏵ accept edits on (shift+tab to cycle)']

describe('a Claude footer with no status line above it', () => {
  it('has had its status line taken out of every capture', () => {
    for (const screen of [MANUAL_2_1_270, AUTO_2_1_281, BYPASS_2_1_278, SHELL_2_1_277]) {
      expect(screen.some((row) => /^\s*\[(?:Opus|Haiku|Fable|Sonnet)/.test(row))).toBe(false)
    }
  })

  it.each<[string, string[], TerminalPermissionMode]>([
    ['2.1.281 with the whole hint', AUTO_2_1_281, 'auto'],
    ['2.1.270 in manual mode, no hint', MANUAL_2_1_270, 'manual'],
    ['2.1.278 at 46 columns, the hint cut short', BYPASS_2_1_278, 'bypassPermissions'],
    ['2.1.277 with a shell running, no hint', SHELL_2_1_277, 'auto'],
    ['a hand-started claude in accept edits', ACCEPT_EDITS_2026_09_18, 'acceptEdits']
  ])('reads the permission mode off the footer Claude Code %s painted', (_build, screen, mode) => {
    expect(parseTerminalHudObservation(screen)).toMatchObject({
      // No badge: the model and effort are not the screen's to state here.
      modelLabel: '',
      modelId: null,
      effort: null,
      // And no figure: no ring and no percentage.
      context: null,
      permissionMode: mode,
      permissionModeSeen: mode
    })
  })

  it('reads the shell count the footer states, one shell or several', () => {
    expect(parseTerminalHudObservation(SHELL_2_1_277)?.runningShellCount).toBe(1)
    expect(parseTerminalHudObservation(SHELLS_2026_09_14)).toMatchObject({
      permissionModeSeen: 'auto',
      runningShellCount: 4
    })
    // A footer that states none leaves the field out, so the caller keeps its own count.
    expect(parseTerminalHudObservation(AUTO_2_1_281)).not.toHaveProperty('runningShellCount')
  })

  it('reads the verb of the spinner above a bare footer', () => {
    expect(parseTerminalHudObservation(SHELL_2_1_277)?.activity).toBe('Frolicking')
  })

  it('reads nothing when no footer is painted, or the screen is empty', () => {
    // A question covers the footer (2.1.282, tmux; its status line taken out).
    const ask = readCapture('claude-screen-ask-single-select-2.1.282.txt')
    const start = ask.indexOf('=== screen: ask ===') + 1
    const question = ask.slice(start, ask.indexOf('=== screen: after 2 ===')).filter((row) => !/^\s*\[Opus/.test(row))
    expect(parseTerminalHudObservation(question)).toBeNull()
    expect(parseTerminalHudObservation(['⏺ I would not use bypass permissions on prod.'])).toBeNull()
    // The hint in a line of conversation is not a footer: no mode is stated,
    // so none is claimed, Manual included.
    expect(
      parseTerminalHudObservation(['⏺ Press shift+tab to cycle through the modes.', '', RULE_100, '❯ ', RULE_100])
    ).toBeNull()
    expect(parseTerminalHudObservation([])).toBeNull()
    expect(parseTerminalHudObservation([''])).toBeNull()
  })

  it("still reads Codex's footer, which names a model, as Codex", () => {
    const plan = [
      '› Ask Codex to do anything',
      '  gpt-5.6-sol medium · ~/Project                          Plan mode (shift+tab to cycle)'
    ]
    expect(parseTerminalHudObservation(plan)).toEqual(parseCodexHudObservation(plan))
    expect(parseTerminalHudObservation(plan)).toMatchObject({ modelId: 'gpt-5.6-sol', agentMode: 'plan' })
  })
})

// What Claude Code 2.1.266 sends once it has replied once (hud-beacon-fields.test.ts).
const SID = '77954fea-1013-4225-b187-a8b3162a04ce'
const BEACON = parseAgentHudBeaconPayload(
  `CUIHUD1 agent=claude sid=${SID} model=claude-fable-5-1 name=Fable%205.1 effort=medium used=649540 win=1000000 pct=64`,
  0
) as AgentHudBeacon

describe('the pill over a bare footer, with a beacon', () => {
  it('says the mode the footer states, not Manual', () => {
    const merged = applyAgentHudBeaconFields(parseTerminalHudObservation(ACCEPT_EDITS_2026_09_18), BEACON)
    expect(merged).toMatchObject({
      modelId: 'claude-fable-5-1',
      permissionMode: 'acceptEdits',
      permissionModeSeen: 'acceptEdits'
    })
  })

  it('states no mode at all when no screen has been read', () => {
    const merged = applyAgentHudBeaconFields(null, BEACON)
    expect(merged?.modelId).toBe('claude-fable-5-1')
    expect(merged?.permissionMode).toBeNull()
    expect(merged?.permissionModeSeen ?? null).toBeNull()
  })
})

describe('the mode picker on a host with no status line', () => {
  // A desktop Claude whose cycle holds three modes. Each Shift+Tab moves the
  // footer one step and the screen repaints; the stepper reads it through the
  // real parser, as MobileSessionActiveContent does.
  function desk(cycle: readonly string[][], start: number) {
    let at = start
    let presses = 0
    let clock = 0
    return {
      // A clock the waits move, so a run that never sees its mode spends its
      // settle windows at once instead of eight real seconds.
      now: () => clock,
      wait: async (ms: number) => {
        clock += ms
      },
      read: async () => shownPermissionMode(parseTerminalHudObservation(cycle[at]!)?.permissionModeSeen),
      press: async () => {
        presses += 1
        at = (at + 1) % cycle.length
      },
      presses: () => presses,
      at: () => at
    }
  }
  const CYCLE = [MANUAL_2_1_270, ACCEPT_EDITS_2026_09_18, AUTO_2_1_281]

  it('reaches the mode asked for in the presses it takes, and says so', async () => {
    const terminal = desk(CYCLE, 0)
    const reached = await stepTerminalMode<TerminalPermissionMode>({
      read: terminal.read,
      press: terminal.press,
      wait: terminal.wait,
      now: terminal.now,
      wanted: 'auto',
      maxPresses: 6
    })
    expect({ reached, presses: terminal.presses() }).toEqual({ reached: true, presses: 2 })
    expect(terminal.at()).toBe(2)
  })

  it('presses nothing when the footer already shows the mode', async () => {
    const terminal = desk(CYCLE, 1)
    const reached = await stepTerminalMode<TerminalPermissionMode>({
      read: terminal.read,
      press: terminal.press,
      wait: terminal.wait,
      now: terminal.now,
      wanted: 'acceptEdits',
      maxPresses: 6
    })
    expect({ reached, presses: terminal.presses() }).toEqual({ reached: true, presses: 0 })
  })

  it("takes 'default' and 'manual' for one mode, and keeps an unread footer unread", () => {
    expect(shownPermissionMode('default')).toBe('manual')
    expect(shownPermissionMode('manual')).toBe('manual')
    expect(shownPermissionMode('auto')).toBe('auto')
    expect(shownPermissionMode(null)).toBeNull()
    expect(shownPermissionMode(undefined)).toBeNull()
  })
})
