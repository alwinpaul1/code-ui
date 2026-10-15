import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { composer, postedTexts, render, resetCcrComposerHarness, send, settle, state, unmount } from './ccr-composer-send.test-support'

/**
 * The Claude app moves the queue back to the composer at a turn's end when the composer holds
 * attachments (ccr-local-queue.ts, its blocker list). The phone's chat controller handed
 * useCcrComposerSend a constant `attachments: 0`, so that blocker could never fire: a queue went
 * out over a picture the user had attached while Claude worked. The count lives in the image
 * hook (use-mobile-native-chat-image-attachments.ts), which is created after the controller,
 * so the overlay that holds both reports it and the hook reads it at the turn end.
 *
 * A defect of wiring, with no behavioural handle short of mounting the whole session screen:
 * this reads the source, comments stripped, so the prose about the count cannot satisfy it.
 */

const here = __dirname
const code = (file: string): string =>
  readFileSync(join(here, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

function callOf(source: string, callee: string): string {
  const start = source.indexOf(`${callee}({`)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('})', start)
  return source.slice(start, end)
}

describe('the queue at the turn end sees what the composer has attached', () => {
  it('the controller hands the Anthropic send a live attachment count, not a constant', () => {
    const call = callOf(code('use-mobile-native-chat-controller.ts'), 'useCcrComposerSend')
    expect(call).not.toMatch(/attachments:\s*\d/)
    expect(call).toMatch(/attachments:\s*\(\)\s*=>\s*ccrComposerAttachments\.current/)
  })

  it("the overlay reports the composer's attachment count to the controller", () => {
    expect(code('MobileNativeChatOverlay.tsx')).toMatch(/reportAttachments = controller\.setNativeChatComposerAttachments/)
    expect(code('MobileNativeChatOverlay.tsx')).toMatch(/reportAttachments\?\.\(images\.attachments\.length\)/)
  })
})

describe('a picture attached while Claude worked', () => {
  beforeEach(resetCcrComposerHarness)
  afterEach(unmount)

  it('moves the queue back to the composer at the turn end instead of sending it', async () => {
    state.working = true
    render()
    await send('look at this')
    state.attachments = 1
    state.working = false
    render()
    await settle()
    expect(postedTexts()).toEqual([])
    expect(composer.text).toBe('look at this')
  })

  it('sends the queue at the turn end with nothing attached', async () => {
    state.working = true
    render()
    await send('no picture')
    state.working = false
    render()
    await settle()
    expect(postedTexts().map((post) => post.text)).toEqual(['no picture'])
  })
})
