import { parseTerminalActivity } from './mobile-terminal-hud-parse'
import { describe, expect, it } from 'vitest'
import {
  parseClaudeRunningShellCount,
  parseTerminalHudObservation,
  parseTerminalPermissionMode
} from './mobile-terminal-hud-parse'

describe('parseTerminalHudObservation', () => {
  it('reads model and effort from the claude-hud badge', () => {
    expect(
      parseTerminalHudObservation([
        '❯',
        '  [Fable 5.1 high | Max 20x] ████████░░ 78% (776k/1.0M) | mobile git:(main)',
        '  Weekly █░░░░░░░░░ 6%'
      ])
    ).toEqual({
      modelLabel: 'Fable 5.1',
      modelId: 'fable',
      effort: 'high',
      context: { usedPercent: 78, usedLabel: '776k', windowLabel: '1.0M' },
      permissionMode: 'default',
      permissionModeSeen: null
    })
  })

  it('handles a badge without effort and a Bedrock label', () => {
    expect(
      parseTerminalHudObservation(['  [Opus 4.8 (1M context) | Bedrock] ██░░ 61% (60…'])
    ).toEqual({
      modelLabel: 'Opus 4.8 (1M context)',
      modelId: 'opus',
      effort: null,
      context: { usedPercent: 61, usedLabel: null, windowLabel: null },
      permissionMode: 'default',
      permissionModeSeen: null
    })
  })

  it('reads the Code UI status line context figure and tolerates its absence', () => {
    expect(
      parseTerminalHudObservation(['[Fable 5.1 · effort high] ctx 54% 537.2k/1M ~/Desktop/x'])
    ).toEqual({
      modelLabel: 'Fable 5.1',
      modelId: 'fable',
      effort: 'high',
      context: { usedPercent: 54, usedLabel: '537.2k', windowLabel: '1M' },
      permissionMode: 'default',
      permissionModeSeen: null
    })
    expect(parseTerminalHudObservation(['[Fable 5.1 · effort high] ~/x'])).toMatchObject({
      context: null,
      permissionMode: 'default',
      permissionModeSeen: null
    })
  })

  it('reads the Code UI status line badge (no auth segment, "effort" label, middle dot)', () => {
    expect(
      parseTerminalHudObservation(['[Fable 5.1 · effort high] ~/Desktop/Project/Thesis', '❯'])
    ).toEqual({
      modelLabel: 'Fable 5.1',
      modelId: 'fable',
      effort: 'high',
      context: null,
      permissionMode: 'default',
      permissionModeSeen: null
    })
    expect(parseTerminalHudObservation(['[Sonnet 5] ~/x'])).toEqual({
      modelLabel: 'Sonnet 5',
      modelId: 'sonnet',
      effort: null,
      context: null,
      permissionMode: 'default',
      permissionModeSeen: null
    })
  })

  it('unwraps ultracode and ignores brackets that are not a model badge', () => {
    expect(
      parseTerminalHudObservation(['  [x] done', '  [Opus 5 ultracode(xhigh) | Team] 62%'])
    ).toEqual({
      modelLabel: 'Opus 5',
      modelId: 'opus',
      effort: 'xhigh',
      context: { usedPercent: 62, usedLabel: null, windowLabel: null },
      permissionMode: 'default',
      permissionModeSeen: null
    })
    expect(parseTerminalHudObservation(['nothing here', '[not a model | x]'])).toBeNull()
  })

  it('reads the permission mode from the input footer', () => {
    expect(parseTerminalPermissionMode(['❯ ', '  ⏵⏵ accept edits on (shift+tab to cycle)'])).toBe(
      'acceptEdits'
    )
    expect(parseTerminalPermissionMode(['  ⏸ plan mode on (shift+tab to cycle)'])).toBe('plan')
    expect(parseTerminalPermissionMode(['  ⏵⏵ auto mode on'])).toBe('auto')
    expect(parseTerminalPermissionMode(['  ⏸ manual mode on'])).toBe('manual')
    expect(parseTerminalPermissionMode(['  ⏵⏵ bypass permissions on'])).toBe('bypassPermissions')
    expect(parseTerminalPermissionMode(['❯ ', '[Fable 5.1 · effort high] ctx 12%'])).toBe('default')
    expect(
      parseTerminalHudObservation([
        '[Fable 5.1 · effort high]',
        '  ⏸ plan mode on (shift+tab to cycle)'
      ])
    ).toMatchObject({ permissionMode: 'plan' })
  })
})

describe('parseTerminalHudObservation — Codex footer', () => {
  it('reads the model and reasoning effort from the Codex input footer', () => {
    expect(
      parseTerminalHudObservation([
        '• Model changed to gpt-6-astra medium',
        '› Ask Codex to do anything',
        '  gpt-6-astra medium · ~/Desktop/Project/Code UI'
      ])
    ).toEqual({
      modelLabel: 'gpt-6-astra',
      modelId: 'gpt-6-astra',
      effort: 'medium',
      context: null,
      permissionMode: 'default',
      permissionModeSeen: null,
      agentMode: 'default'
    })
  })

  it('treats a "default" reasoning word as no effort', () => {
    const observation = parseTerminalHudObservation([
      '  gpt-6-astra default · ~/Desktop/Project/Code UI'
    ])
    expect(observation?.modelId).toBe('gpt-6-astra')
    expect(observation?.effort).toBeNull()
  })

  it('ignores middot prose that is not a model footer', () => {
    expect(
      parseTerminalHudObservation(['✻ Worked for 4s · done 1:32 PM', 'new task? /clear'])
    ).toBeNull()
  })

  it('prefers the Claude badge when both could match', () => {
    expect(parseTerminalHudObservation(['  [Opus 5 high | Max 20x] 61%'])?.modelId).toBe('opus')
  })
})

describe('Codex mode and context from the screen', () => {
  it('reads Plan mode from the footer and Default when absent', () => {
    expect(
      parseTerminalHudObservation([
        '› Ask Codex to do anything',
        '  gpt-5.6-sol medium · ~/Project                          Plan mode (shift+tab to cycle)'
      ])?.agentMode
    ).toBe('plan')
    expect(
      parseTerminalHudObservation(['› Ask Codex to do anything', '  gpt-5.6-sol xhigh · ~/Project'])
        ?.agentMode
    ).toBe('default')
  })

  it('turns the /status "left" figure into a used-percent context window', () => {
    const observation = parseTerminalHudObservation([
      '│  Context window:              97% left (19.5K used / 258K)                              │',
      '╰───────────────────────────────────────────────────────────────────────────────────────╯',
      '› Ask Codex to do anything',
      '  gpt-5.6-sol xhigh · ~/Project'
    ])
    expect(observation?.context).toEqual({
      usedPercent: 3,
      usedLabel: '19.5K',
      windowLabel: '258K'
    })
  })

  it('reads the "N% context left" footer codex-cli 0.153.4 paints after /status', () => {
    // Captured from a live Galaxy S23 session on 2026-09-09 (orca terminal show):
    // the figure sits right-aligned on the line above the composer, and the
    // `/status` box with token figures is gone.
    const observation = parseTerminalHudObservation([
      '› Reply with the single word ready.   tab to queue message',
      '                                                                        100% context left',
      '› Reply with the single word ready.',
      '  gpt-5.6-terra xhigh · ~/Desktop/Project/Code UI'
    ])
    expect(observation?.context).toEqual({ usedPercent: 0, usedLabel: null, windowLabel: null })
    expect(observation?.modelId).toBe('gpt-5.6-terra')
    const partly = parseTerminalHudObservation([
      '                                            62% context left',
      '› Ask Codex to do anything',
      '  gpt-5.6-terra xhigh · ~/p'
    ])
    expect(partly?.context?.usedPercent).toBe(38)
  })

  // Wording taken from the Claude Code 2.1.266 binary's string table; the
  // layout below is the footer as Claude Code paints it, not a live capture
  // of a near-full session (none was available on 2026-09-09). The figures
  // state what is LEFT; the ring shows what is used.
  it('reads the context figure Claude Code paints itself when no status line is installed', () => {
    const lowered = parseTerminalHudObservation([
      '─────────────────────────────────────────────',
      '⏵⏵ accept edits on (shift+tab to cycle) · 12% until auto-compact'
    ])
    expect(lowered?.context).toEqual({ usedPercent: 88, usedLabel: null, windowLabel: null })
    expect(lowered?.permissionMode).toBe('acceptEdits')
    // No badge: the model is not ours to state here; Orca's hook supplies it.
    expect(lowered?.modelId).toBeNull()

    const low = parseTerminalHudObservation([
      'Context low (8% remaining) · Run /compact to compact & continue',
      '⏵⏵ auto mode on (shift+tab to cycle)'
    ])
    expect(low?.context?.usedPercent).toBe(92)

    const older = parseTerminalHudObservation([
      '⏵⏵ auto mode on (shift+tab to cycle)   Context left until auto-compact: 30%'
    ])
    expect(older?.context?.usedPercent).toBe(70)
  })

  it('states the mode but no figure on a bare Claude footer rather than guessing', () => {
    // The footer is still read for its mode (claude-footer-without-status-line.test.ts);
    // no figure is on it, so the ring and the model stay blank.
    expect(parseTerminalHudObservation(['⏵⏵ auto mode on (shift+tab to cycle) · ← for agents'])).toMatchObject({
      modelId: null,
      effort: null,
      context: null,
      permissionModeSeen: 'auto'
    })
  })
})

// Claude Code 2.1.268's spinner line while a turn runs, as painted on the S23
// on 2026-09-12. The Claude app shows the same verb above its composer.
describe('parseTerminalActivity', () => {
  it('reads the verb off the spinner line', () => {
    expect(
      parseTerminalActivity(['some output', '✳ Cooking… (2m 14s · ↓ 1.2k tokens · esc to interrupt)', '', '> '])
    ).toBe('Cooking')
    expect(parseTerminalActivity(['✻ Thinking… (esc to interrupt)'])).toBe('Thinking')
  })

  it('is null when nothing is spinning', () => {
    expect(parseTerminalActivity(['⏺ Done.', '> '])).toBeNull()
    expect(parseTerminalActivity([])).toBeNull()
  })
})

describe('parseClaudeRunningShellCount', () => {
  // Real footer, 2026-09-14: "▶▶ auto mode on · 4 shells · ← for agents".
  it('reads the shell count Claude Code prints in its footer', () => {
    expect(
      parseClaudeRunningShellCount(['▶▶ auto mode on · 4 shells · ← for agents'])
    ).toBe(4)
    expect(parseClaudeRunningShellCount(['⏵⏵ accept edits on · 2 shells'])).toBe(2)
    expect(parseClaudeRunningShellCount(['⏵ auto mode on · 1 shell'])).toBe(1)
  })

  it('is null when the footer states no shells', () => {
    expect(parseClaudeRunningShellCount(['▶▶ auto mode on · ← for agents'])).toBeNull()
    expect(parseClaudeRunningShellCount(['> ', '❯'])).toBeNull()
  })

  it('does not mistake "N shells" in ordinary output for the footer', () => {
    // No middot separator: a line of prose that happens to say "4 shells".
    expect(parseClaudeRunningShellCount(['I opened 4 shells earlier'])).toBeNull()
  })

  it('carries the footer count onto the observation', () => {
    const observation = parseTerminalHudObservation([
      '[Opus 4.8 (1M context) xhigh | Max 20x]  55% (548k/1.0M)',
      '▶▶ auto mode on · 4 shells · ← for agents'
    ])
    expect(observation?.runningShellCount).toBe(4)
  })
})

// With no status line, the observation comes from Claude Code's own footer
// once it warns that context is low. That branch dropped the footer's shell
// count, and it ran only when "shift+tab to cycle" was on screen, which the
// footers captured with a shell running do not paint (review, 2026-09-30).
// The warning row is worded from the 2.1.266 binary's string table
// (docs/mobile-agent-hud.md, 2026-09-09 night; no near-full session has been
// captured), laid out as the test above reads it. Each footer is a capture.
describe("Claude Code's own low-context warning over the footers it paints", () => {
  const LOW = 'Context low (8% remaining) · Run /compact to compact & continue'

  it('keeps the shell count the footer states while context is low', () => {
    // 2.1.277, orca terminal read 2026-09-19 (mobile-terminal-queued-messages.test.ts).
    expect(parseTerminalHudObservation([LOW, '  ⏵⏵ auto mode on · 1 shell · ← for agents'])).toMatchObject({
      modelId: null,
      context: { usedPercent: 92, usedLabel: null, windowLabel: null },
      permissionMode: 'auto',
      permissionModeSeen: 'auto',
      runningShellCount: 1
    })
  })

  it.each([
    ['2.1.270 and 2.1.276 in manual mode (tmux)', '  ⏸ manual mode on · ← for agents', 'manual'],
    ['2.1.278 at 46 columns, the hint cut short (tmux)', '  ⏵⏵ bypass permissions on (shift+tab to  ·', 'bypassPermissions']
  ])('reads the warning over the footer %s paints without the whole hint', (_build, footer, mode) => {
    const observation = parseTerminalHudObservation([LOW, footer])
    expect(observation?.context?.usedPercent).toBe(92)
    expect(observation?.permissionModeSeen).toBe(mode)
    expect(observation).not.toHaveProperty('runningShellCount')
  })

  it('takes no context figure from the conversation above a footer that has no hint', () => {
    // 2.1.270's composer and footer, tmux 2026-09-13 (mobile-terminal-sent-prompts.test.ts).
    const rule = '─'.repeat(100)
    const screen = ['⏺ The ring said context 54% a minute ago.', '', rule, '❯\u00a0', rule, '  ⏸ manual mode on · ← for agents']
    expect(parseTerminalHudObservation(screen)).toMatchObject({ context: null, permissionModeSeen: 'manual' })
    expect(parseTerminalHudObservation([LOW, ...screen.slice(1)])?.context?.usedPercent).toBe(92)
  })

  it('stays silent when the warning has no footer under it, or only conversation', () => {
    expect(parseTerminalHudObservation([LOW])).toBeNull()
    expect(parseTerminalHudObservation([LOW, 'I would not use bypass permissions on prod.'])).toBeNull()
  })

  it('reads the shell count but no figure off a footer with no warning, and nothing off an empty screen', () => {
    expect(parseTerminalHudObservation(['  ⏵⏵ auto mode on · 1 shell · ← for agents'])).toMatchObject({
      context: null,
      permissionModeSeen: 'auto',
      runningShellCount: 1
    })
    expect(parseTerminalHudObservation([])).toBeNull()
    expect(parseTerminalHudObservation([''])).toBeNull()
  })
})

// A Codex screen reaches parseTerminalHudObservation only when the tab's agent
// is not known as codex (a hand-started Codex): the live hook sends a known
// Codex tab straight to parseCodexHudObservation. In Plan mode Codex paints
// "Plan mode (shift+tab to cycle)" at its footer's right edge, and that hint
// was taken for Claude Code's, so the Claude branch read Codex's "N% context
// left" as N% USED and dropped the model, the effort and the Plan pill
// (review, 2026-09-30).
describe('a Codex footer in Plan mode, read without knowing the agent', () => {
  const PLAN_HINT = 'Plan mode (shift+tab to cycle)'
  // codex-cli 0.153.4, live capture 2026-09-09 (the "N% context left" test
  // above), its footer row carrying the Plan hint the way the Plan row read
  // earlier in this file paints it: right-aligned after the path.
  const PLAN_0_153_4 = [
    '› Reply with the single word ready.   tab to queue message',
    '                                                                        100% context left',
    '› Reply with the single word ready.',
    `  gpt-5.6-terra xhigh · ~/Desktop/Project/Code UI                 ${PLAN_HINT}`
  ]
  // The row the review ran, the figure on the footer row itself.
  const PLAN_ONE_ROW = `  gpt-5.6-sol xhigh · ~/Project   100% context left   ${PLAN_HINT}`
  // The `context-remaining` item Codex paints when launched with
  // tui.status_line, in the shape CODEX_FOOTER reads it after the middot.
  const PLAN_STATUS_LINE = `  gpt-5.3-codex medium · Context 73% left · ~/Project        ${PLAN_HINT}`

  it('keeps the model, the effort, the Plan pill and an empty ring on a fresh session', () => {
    expect(parseTerminalHudObservation(PLAN_0_153_4)).toMatchObject({
      modelLabel: 'gpt-5.6-terra',
      modelId: 'gpt-5.6-terra',
      effort: 'xhigh',
      agentMode: 'plan',
      context: { usedPercent: 0, usedLabel: null, windowLabel: null }
    })
    expect(parseTerminalHudObservation(['• ok', '› Ask Codex to do anything', PLAN_ONE_ROW])).toMatchObject({
      modelId: 'gpt-5.6-sol',
      effort: 'xhigh',
      agentMode: 'plan',
      context: { usedPercent: 0 }
    })
    // The footer row alone, the smallest screen that carries it.
    expect(parseTerminalHudObservation([PLAN_ONE_ROW])).toMatchObject({
      modelId: 'gpt-5.6-sol',
      agentMode: 'plan',
      context: { usedPercent: 0 }
    })
  })

  it('shows the context used, not the context left, from the status-line item', () => {
    expect(parseTerminalHudObservation(['› Ask Codex to do anything', PLAN_STATUS_LINE])).toMatchObject({
      modelId: 'gpt-5.3-codex',
      effort: 'medium',
      agentMode: 'plan',
      context: { usedPercent: 27, usedLabel: null, windowLabel: null }
    })
  })

  it.each([
    ['codex-cli 0.153.4', PLAN_0_153_4],
    ['the footer row alone', [PLAN_ONE_ROW]],
    ['the status-line item', ['› Ask Codex to do anything', PLAN_STATUS_LINE]]
  ])('reads %s the same in Plan mode as in Default, bar the Plan pill', (_shape, plan) => {
    const inDefault = plan.map((row) => row.replace(PLAN_HINT, '').trimEnd())
    expect(parseTerminalHudObservation(inDefault)?.agentMode).toBe('default')
    expect(parseTerminalHudObservation(plan)).toEqual({
      ...parseTerminalHudObservation(inDefault),
      agentMode: 'plan'
    })
  })

  it("still reads Claude Code's own plan-mode footer and its warning as Claude", () => {
    // The plan row is inferred from the captured mode rows
    // (claude-terminal-mode-footer.ts); the warning is worded from the 2.1.266
    // binary, as in the block above.
    const observation = parseTerminalHudObservation([
      'Context low (8% remaining) · Run /compact to compact & continue',
      '  ⏸ plan mode on (shift+tab to cycle)'
    ])
    expect(observation).toMatchObject({
      modelLabel: '',
      modelId: null,
      context: { usedPercent: 92 },
      permissionModeSeen: 'plan'
    })
    expect(observation).not.toHaveProperty('agentMode')
  })

  it('keeps a Claude screen whose reply quotes a Codex Plan footer as Claude', () => {
    // 2.1.270's composer and footer, tmux 2026-09-13 (mobile-terminal-sent-prompts.test.ts).
    const rule = '─'.repeat(100)
    const observation = parseTerminalHudObservation([
      `⏺ Codex paints "gpt-5.6-sol xhigh · ~/Project   ${PLAN_HINT}" in Plan mode.`,
      'Context low (8% remaining) · Run /compact to compact & continue',
      rule,
      '❯ ',
      rule,
      '  ⏸ manual mode on · ← for agents'
    ])
    expect(observation).toMatchObject({ modelId: null, context: { usedPercent: 92 }, permissionModeSeen: 'manual' })
    expect(observation).not.toHaveProperty('agentMode')
  })
})
