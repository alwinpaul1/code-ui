import { describe, expect, it, vi } from 'vitest'
import { closeTranscriptTailLeftovers, isTranscriptTailLeftover } from './transcript-tail-leftovers'

// The 2026-09-19 dev builds tailed the transcript through a host terminal
// titled "Code UI · transcript"; an install over adb mid-chat left that tab
// on the desktop. The sweep closes exactly that, and nothing of the user's.
describe('a transcript-tail tab an earlier build left on the desktop', () => {
  it('is recognised by its exact title, live only', () => {
    expect(isTranscriptTailLeftover({ title: 'Code UI · transcript', connected: true })).toBe(true)
    expect(isTranscriptTailLeftover({ title: ' Code UI · transcript ', connected: true })).toBe(true)
    expect(isTranscriptTailLeftover({ title: 'Code UI · transcript', connected: false })).toBe(false)
    expect(isTranscriptTailLeftover({ title: 'claude', connected: true })).toBe(false)
    expect(isTranscriptTailLeftover({ title: null, connected: true })).toBe(false)
    expect(isTranscriptTailLeftover({})).toBe(false)
  })

  it('closes the whole tab of each leftover once, and touches no other terminal', async () => {
    const calls: { method: string; params: unknown }[] = []
    const client = {
      sendRequest: vi.fn(async (method: string, params: unknown) => {
        calls.push({ method, params })
        return { ok: true, result: { closed: true } }
      })
    }
    const listing = [
      { handle: 'term_tail', title: 'Code UI · transcript', connected: true },
      { handle: 'term_user', title: 'claude', connected: true },
      { handle: 'term_gone', title: 'Code UI · transcript', connected: false }
    ]
    closeTranscriptTailLeftovers(client as never, listing)
    closeTranscriptTailLeftovers(client as never, listing)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls.map((call) => call.method)).toEqual(['terminal.closeTab'])
    expect(calls[0]!.params).toMatchObject({ terminal: 'term_tail' })
  })

  it('does not throw when the host refuses the close', async () => {
    const client = { sendRequest: vi.fn(async () => ({ ok: false, error: { code: 'nope' } })) }
    expect(() =>
      closeTranscriptTailLeftovers(client as never, [{ handle: 'term_tail', title: 'Code UI · transcript', connected: true }])
    ).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
