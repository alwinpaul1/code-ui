import { describe, expect, it } from 'vitest'
import {
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
      permissionMode: 'default'
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
      permissionMode: 'default'
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
      permissionMode: 'default'
    })
    expect(parseTerminalHudObservation(['[Fable 5.1 · effort high] ~/x'])).toMatchObject({
      context: null,
      permissionMode: 'default'
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
      permissionMode: 'default'
    })
    expect(parseTerminalHudObservation(['[Sonnet 5] ~/x'])).toEqual({
      modelLabel: 'Sonnet 5',
      modelId: 'sonnet',
      effort: null,
      context: null,
      permissionMode: 'default'
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
      permissionMode: 'default'
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

  it('stays silent on a bare Claude footer with no figure rather than guessing', () => {
    expect(parseTerminalHudObservation(['⏵⏵ auto mode on (shift+tab to cycle) · ← for agents'])).toBeNull()
  })
})
