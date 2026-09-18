import { describe, expect, it } from 'vitest'
import { rpcRefusal, rpcSuccess } from '../transport/rpc-operation-test-families'
import { terminalScreenLinesRead } from './mobile-terminal-ask-about-screen-operations'

describe('reading terminal.read\'s screen reply for "Ask about this screen"', () => {
  it('reads the tail lines when the host answers a real screen read', () => {
    const verdict = terminalScreenLinesRead.interpret(
      rpcSuccess({ terminal: { source: 'screen', tail: ['$ echo hi', 'hi'] } })
    )
    expect(verdict).toEqual(['$ echo hi', 'hi'])
  })

  it('falls back to `lines` when the reply carries no tail', () => {
    const verdict = terminalScreenLinesRead.interpret(
      rpcSuccess({ terminal: { source: 'screen', lines: ['only line'] } })
    )
    expect(verdict).toEqual(['only line'])
  })

  it('refuses a stream-fallback reply — an old host that ignored screen:true — rather than trust stale repaints', () => {
    const verdict = terminalScreenLinesRead.interpret(
      rpcSuccess({ terminal: { source: 'stream', tail: ['stale', 'output'] } })
    )
    expect(verdict).toBeNull()
  })

  it('is null on a transport refusal', () => {
    const verdict = terminalScreenLinesRead.interpret(rpcRefusal('unavailable', 'no such terminal'))
    expect(verdict).toBeNull()
  })

  it('is null when the reply carries no usable line array', () => {
    const verdict = terminalScreenLinesRead.interpret(rpcSuccess({ terminal: {} }))
    expect(verdict).toBeNull()
  })
})
