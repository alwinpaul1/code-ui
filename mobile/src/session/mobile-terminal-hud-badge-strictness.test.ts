import { describe, expect, it } from 'vitest'
import { parseTerminalHudObservation } from './mobile-terminal-hud-parse'

// "showing wrong model name at some point randomly", reported 2026-09-15.
//
// The badge reader scans every line bottom-up for ANY bracketed text and then
// accepts it if the contents merely CONTAIN "opus"/"sonnet"/"fable"/"haiku"
// anywhere. So a line the agent happened to print — a list of model ids in
// source, a sentence naming a model — was read as the session's status line,
// and the pill changed to whatever it said.
//
// It has always been this loose. What changed today is that the launch record
// and the remembered pick were both removed as model sources (5538219,
// 9e81d68), so the screen read is now one of the few left and its noise is no
// longer masked.
describe('what may be read as the status-line model badge', () => {
  it('ignores a bracketed list of model ids the agent printed as source', () => {
    const screen = [
      '⏺ Reading the model catalogue:',
      "  const MODELS = ['claude-opus-5', 'claude-sonnet-5'];",
      '',
      '❯ '
    ]
    expect(parseTerminalHudObservation(screen)?.modelId ?? null).toBe(null)
  })

  it('ignores a model named in the agent’s own prose', () => {
    const screen = ['⏺ I will switch to [Sonnet 4.5] for this step.', '', '❯ ']
    expect(parseTerminalHudObservation(screen)?.modelId ?? null).toBe(null)
  })

  it('ignores a bracketed file path that happens to carry the word', () => {
    const screen = ['  ⎿  Wrote [docs/opus-migration-notes.md]', '', '❯ ']
    expect(parseTerminalHudObservation(screen)?.modelId ?? null).toBe(null)
  })

  it('still reads a real status-line badge', () => {
    const screen = ['[Opus 4.8 xhigh | Max 20x]  main  ~/code', '❯ ']
    const hud = parseTerminalHudObservation(screen)
    expect(hud?.modelId).toBe('opus')
    expect(hud?.modelLabel).toBe('Opus 4.8')
    expect(hud?.effort).toBe('xhigh')
  })

  it('still reads a badge with no effort and a plain family name', () => {
    expect(parseTerminalHudObservation(['[Fable 5.1]', '❯ '])?.modelLabel).toBe('Fable 5.1')
    expect(parseTerminalHudObservation(['[Haiku 4.5 | Pro]', '❯ '])?.modelId).toBe('haiku')
  })

  it('reads the badge when the status line is not the last row', () => {
    const screen = ['[Sonnet 5 high | Max]  main', 'some later output', '❯ ']
    expect(parseTerminalHudObservation(screen)?.modelId).toBe('sonnet')
  })
})
