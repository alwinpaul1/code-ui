import { describe, expect, it } from 'vitest'
import { parseTerminalHudObservation, parseTerminalPermissionMode } from './mobile-terminal-hud-parse'

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
    ).toEqual({ modelLabel: 'Fable 5.1', modelId: 'fable', effort: 'high', context: null, permissionMode: 'default' })
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
    expect(parseTerminalPermissionMode(['❯ ', '  ⏵⏵ accept edits on (shift+tab to cycle)'])).toBe('acceptEdits')
    expect(parseTerminalPermissionMode(['  ⏸ plan mode on (shift+tab to cycle)'])).toBe('plan')
    expect(parseTerminalPermissionMode(['  ⏵⏵ auto mode on'])).toBe('auto')
    expect(parseTerminalPermissionMode(['  ⏸ manual mode on'])).toBe('manual')
    expect(parseTerminalPermissionMode(['  ⏵⏵ bypass permissions on'])).toBe('bypassPermissions')
    expect(parseTerminalPermissionMode(['❯ ', '[Fable 5.1 · effort high] ctx 12%'])).toBe('default')
    expect(
      parseTerminalHudObservation(['[Fable 5.1 · effort high]', '  ⏸ plan mode on (shift+tab to cycle)'])
    ).toMatchObject({ permissionMode: 'plan' })
  })
})
