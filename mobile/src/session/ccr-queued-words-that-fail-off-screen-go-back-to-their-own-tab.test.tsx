/**
 * Words queued on one Claude tab whose POST fails after the user has switched to another tab go
 * back to the draft of the tab they were queued on, ahead of what it holds (typed after them), and
 * never into the composer on screen. Second-pass review of ed40d4552, 2026-10-15: they were written
 * through the composer of whichever tab was on screen ("queued on A\n\nB's draft"), switch on or
 * off, on the turn-end send and on the queue sent ahead of a photo.
 */
import { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { composer, drafts, hook, io, postedTexts, render, resetCcrComposerHarness, send, settle, state, unmount } from './ccr-composer-send.test-support'
import type { CcrSendFiles } from './use-ccr-composer-send'

const PHOTO: CcrSendFiles = { attachments: [{ file_uuid: 'file_01A', file_name: 'image.jpg', is_image: true }], previewUris: ['file:///a.jpg'], accountId: 'acct-personal' }

beforeEach(resetCcrComposerHarness)
afterEach(unmount)

/** Queues `text` on tab A while Claude works there; the next POST is held open until `fail`. */
async function queueOnTabAWithPostHeld(text: string): Promise<{ fail: () => void }> {
  state.tabId = 'tab-a'
  state.working = true
  render()
  expect(await send(text)).toBe('accepted')
  // Typed on tab A after the queued words.
  drafts['draft:tab-a'] = "A's later words"
  const held = { fail: () => undefined as void }
  io.post = () => new Promise<void>((_resolve, reject) => { held.fail = () => reject(new Error('network')) })
  return held
}

async function switchToTabBWithItsDraft(): Promise<void> {
  state.tabId = 'tab-b'
  state.working = false
  composer.text = "B's draft"
  render()
  await settle()
}

describe("queued words whose POST fails while another tab is on screen", () => {
  it("go back to their own tab's draft ahead of its later words when the turn-end send fails, and B's composer keeps only B's draft", async () => {
    const post = await queueOnTabAWithPostHeld('queued on A')
    state.working = false
    render()
    await settle()
    expect(postedTexts().map((p) => p.text)).toEqual(['queued on A'])
    await switchToTabBWithItsDraft()
    await act(async () => { post.fail() })
    await settle()
    expect(composer.text).toBe("B's draft")
    expect(drafts['draft:tab-a']).toBe("queued on A\n\nA's later words")
  })

  it("go back to their own tab's draft when the queue sent ahead of a photo fails, and B's composer keeps only B's draft", async () => {
    const post = await queueOnTabAWithPostHeld('queued on A')
    let photo: Promise<string> = Promise.resolve('')
    act(() => { photo = hook.api.sendWithOutcome('look at this', PHOTO) })
    await settle()
    expect(postedTexts().map((p) => p.text)).toEqual(['queued on A'])
    await switchToTabBWithItsDraft()
    await act(async () => { post.fail() })
    let outcome = ''
    await act(async () => { outcome = await photo })
    expect(outcome).toBe('rejected')
    expect(composer.text).toBe("B's draft")
    expect(drafts['draft:tab-a']).toBe("queued on A\n\nA's later words")
  })
})
