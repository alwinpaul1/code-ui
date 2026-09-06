import { describe, expect, it } from 'vitest'
import { acceptCodexStatusModel } from './use-codex-current-model'

describe('acceptCodexStatusModel', () => {
  it('takes the hook-reported model when the account list names it', () => {
    expect(acceptCodexStatusModel('gpt-5.6-sol', ['gpt-6-astra', 'gpt-5.6-sol'])).toBe(
      'gpt-5.6-sol'
    )
  })

  it('refuses a model outside the known list (the host once labelled a Codex pane with a Claude id)', () => {
    expect(acceptCodexStatusModel('claude-fable-5-1', ['gpt-6-astra'])).toBeNull()
    expect(acceptCodexStatusModel('gpt-reserve', ['gpt-6-astra'])).toBeNull()
  })

  it('with no list yet, accepts only Codex-shaped ids (every Claude model fails)', () => {
    for (const claude of ['claude-opus-5', 'fable', 'Opus 4.8', 'sonnet', 'haiku', 'Fable 5.1']) {
      expect(acceptCodexStatusModel(claude, [])).toBeNull()
    }
    expect(acceptCodexStatusModel('gpt-6-astra', [])).toBe('gpt-6-astra')
    expect(acceptCodexStatusModel('o4-mini', [])).toBe('o4-mini')
    expect(acceptCodexStatusModel('codex-mini-latest', [])).toBe('codex-mini-latest')
    expect(acceptCodexStatusModel('  ', [])).toBeNull()
    expect(acceptCodexStatusModel(undefined, [])).toBeNull()
  })
})
