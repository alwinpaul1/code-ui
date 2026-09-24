import { describe, expect, it } from 'vitest'
import { parseClaudeSpinnerLine } from './mobile-terminal-spinner-line'

// Spinner lines from real Claude Code screens (the same captures the HUD
// parser's tests hold). The thinking words are Claude Code 2.1.281's own,
// from its bundle; the Claude app draws them after the count.
describe("Claude Code's spinner line, read for the status line", () => {
  it('reads the verb before the turn has run long enough to show a time', () => {
    expect(parseClaudeSpinnerLine(['some output', '', '✳ Spinning…', '', '❯'])).toEqual({
      verb: 'Spinning',
      elapsed: null,
      thinking: null
    })
  })

  it('reads the elapsed time and leaves the token count out', () => {
    expect(parseClaudeSpinnerLine(['✻ Frolicking… (15m 36s · ↓ 56.6k tokens)'])).toEqual({
      verb: 'Frolicking',
      elapsed: '15m 36s',
      thinking: null
    })
    expect(parseClaudeSpinnerLine(['✢ Thinking… (21s · ↓ 172 tokens)'])?.elapsed).toBe('21s')
  })

  it("reads Claude Code's thinking status from the end of the parenthesis", () => {
    expect(parseClaudeSpinnerLine(['✶ Cooking… (1m 16s · ↓ 2.3k tokens · thinking some more)'])).toEqual({
      verb: 'Cooking',
      elapsed: '1m 16s',
      thinking: 'thinking some more'
    })
    expect(parseClaudeSpinnerLine(['✻ Cooking… (48s · thought for 3s)'])?.thinking).toBe('thought for 3s')
  })

  it('takes no key hint for a thinking status', () => {
    expect(parseClaudeSpinnerLine(['✻ Frolicking… (1m 2s · ctrl+t to hide todos)'])).toEqual({
      verb: 'Frolicking',
      elapsed: '1m 2s',
      thinking: null
    })
  })

  it('reads a line cut at the wrap column without its closing parenthesis', () => {
    expect(parseClaudeSpinnerLine(['✻ Frolicking… (15m 36s · ↓ 56.6k'])?.elapsed).toBe('15m 36s')
  })

  it("reads nothing off Codex's spinner, which the status line then calls Working", () => {
    expect(parseClaudeSpinnerLine(['• Working (5s • esc to interrupt)', '', '› '])).toBeNull()
  })

  it('reads nothing off an idle screen, or an empty one', () => {
    expect(parseClaudeSpinnerLine(['⏺ Done.', '', '❯ '])).toBeNull()
    expect(parseClaudeSpinnerLine([])).toBeNull()
  })
})
