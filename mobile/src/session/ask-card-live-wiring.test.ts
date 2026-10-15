import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Review of f00febd4a (2026-10-16): the question card hid the composer, and with
 * it Stop, under any ask, the transcript's possibly stale copy included. The
 * view now hides it only when `askLive` says the agent waits on the question,
 * and the controller states that (`nativeChatAskLive`). The overlay is what
 * hands one to the other; leaving the prop off defaults it to false, which
 * keeps the composer under every card and passes every type check.
 *
 * A defect of wiring, with no behavioural handle short of mounting the whole
 * session screen: this reads the source, comments stripped, so the prose about
 * the prop cannot satisfy it.
 */

const here = __dirname
const code = (file: string): string =>
  readFileSync(join(here, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

describe('the question card hears whether the agent waits on it', () => {
  it('the overlay hands the controller’s live flag to the chat view', () => {
    expect(code('MobileNativeChatOverlay.tsx')).toMatch(/askLive=\{controller\.nativeChatAskLive\}/)
  })

  it('the controller reads the flag from the hook row’s question, not the transcript’s', () => {
    expect(code('use-mobile-native-chat-controller.ts')).toMatch(
      /nativeChatAskLive:\s*!activeChatStructured && showNativeChatAsk && nativeChatLiveAsk != null/
    )
  })
})
