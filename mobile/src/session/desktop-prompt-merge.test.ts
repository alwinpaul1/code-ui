import { describe, expect, it } from 'vitest'
import { mergeDesktopPrompts } from './desktop-prompt-merge'

describe('one list of desktop prompts from the tab status and the beacon', () => {
  it('lets the status copy win over the beacon copy of the same message, and keeps the rest', () => {
    // A phone-launched session beacons a desktop prompt from its own hook
    // AND Orca's hook puts it on the tab status; the status copy carries
    // the time the prompt was taken.
    const merged = mergeDesktopPrompts(
      [{ nonce: 'status:s:1:0', text: 'fix the queue', at: 1000 }],
      [
        { nonce: 'beacon-1', text: 'fix the queue' },
        { nonce: 'beacon-2', text: 'and the pill' }
      ]
    )
    expect(merged).toEqual([
      { nonce: 'status:s:1:0', text: 'fix the queue', at: 1000 },
      { nonce: 'beacon-2', text: 'and the pill' }
    ])
  })

  it('is the beacon alone on a host that publishes no status, and empty for neither', () => {
    expect(mergeDesktopPrompts([], [{ nonce: 'b', text: 'hello' }])).toEqual([{ nonce: 'b', text: 'hello' }])
    expect(mergeDesktopPrompts([], [])).toEqual([])
  })
})
