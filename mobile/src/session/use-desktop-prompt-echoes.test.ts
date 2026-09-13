import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { withoutLandedDesktopPrompts } from './use-desktop-prompt-echoes'

function user(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' }
}

// 2026-09-13: a desktop prompt with a pasted screenshot lands in the
// transcript with its `[Image #1]` marker and re-wrapped, and the hook's copy
// of it stayed on screen as a second bubble.
describe('withoutLandedDesktopPrompts', () => {
  it('retires a hook prompt whose transcript row carries image markers', () => {
    const prompts = [{ nonce: 'n1', text: 'See this  tooo' }]
    expect(withoutLandedDesktopPrompts(prompts, [user('u1', '[Image #96] See this tooo')])).toEqual(
      []
    )
  })

  it('drops a prompt the phone itself sent, which already has its pending echo', () => {
    const prompts = [{ nonce: 'n1', text: 'from the phone' }]
    expect(withoutLandedDesktopPrompts(prompts, [], ['from the phone'])).toEqual([])
  })

  it('matches a prompt the hook says it shortened as a prefix of its row', () => {
    const long = 'x'.repeat(2400)
    const prompts = [{ nonce: 'n1', text: long.slice(0, 2000), cut: true }]
    expect(withoutLandedDesktopPrompts(prompts, [user('u1', long)])).toEqual([])
  })

  // 2026-09-13: the cut was guessed from the text's length, and the guess was
  // wrong whenever JSON escapes or multibyte text moved the boundary. A prompt
  // the hook did NOT shorten must never be retired by a longer row.
  it('keeps a whole prompt that merely starts the same as a longer message', () => {
    const prompts = [{ nonce: 'n1', text: 'run the tests' }]
    expect(withoutLandedDesktopPrompts(prompts, [user('u1', 'run the tests and deploy')])).toEqual(
      prompts
    )
  })

  it('keeps a prompt the transcript does not show', () => {
    const prompts = [{ nonce: 'n1', text: 'fix the dock' }]
    expect(withoutLandedDesktopPrompts(prompts, [user('u1', 'something else')])).toEqual(prompts)
  })
})
