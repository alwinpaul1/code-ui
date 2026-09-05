import { describe, expect, it } from 'vitest'
import { parseTerminalHudObservation } from './mobile-terminal-hud-parse'

describe('parseTerminalHudObservation', () => {
  it('reads model and effort from the claude-hud badge', () => {
    expect(
      parseTerminalHudObservation([
        '❯',
        '  [Fable 5.1 high | Max 20x] ████████░░ 78% (776k/1.0M) | mobile git:(main)',
        '  Weekly █░░░░░░░░░ 6%'
      ])
    ).toEqual({ modelLabel: 'Fable 5.1', modelId: 'fable', effort: 'high' })
  })

  it('handles a badge without effort and a Bedrock label', () => {
    expect(
      parseTerminalHudObservation(['  [Opus 4.8 (1M context) | Bedrock] ██░░ 61% (60…'])
    ).toEqual({ modelLabel: 'Opus 4.8 (1M context)', modelId: 'opus', effort: null })
  })

  it('unwraps ultracode and ignores brackets that are not a model badge', () => {
    expect(
      parseTerminalHudObservation(['  [x] done', '  [Opus 5 ultracode(xhigh) | Team] 62%'])
    ).toEqual({ modelLabel: 'Opus 5', modelId: 'opus', effort: 'xhigh' })
    expect(parseTerminalHudObservation(['nothing here', '[not a model | x]'])).toBeNull()
  })
})
