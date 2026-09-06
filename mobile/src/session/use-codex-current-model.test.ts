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

  it('with no list yet, refuses anything that reads as a Claude id', () => {
    expect(acceptCodexStatusModel('claude-opus-5', [])).toBeNull()
    expect(acceptCodexStatusModel('gpt-6-astra', [])).toBe('gpt-6-astra')
    expect(acceptCodexStatusModel('  ', [])).toBeNull()
    expect(acceptCodexStatusModel(undefined, [])).toBeNull()
  })
})
