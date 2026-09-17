import { createElement } from 'react'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import type { BeaconPromptReceipt } from './use-mobile-native-chat-beacon-confirm'

vi.mock('../storage/native-chat-drafts', () => ({
  readNativeChatDraft: vi.fn(async () => null),
  writeNativeChatDraft: vi.fn(async () => undefined)
}))

type DraftState = ReturnType<typeof useMobileNativeChatDrafts>

/** End-to-end for the wiring: the agent's own UserPromptSubmit receipt reaches
 *  the drafts hook and stops the 20 s unconfirmed clock. Without it an ack-lost
 *  send waits the full deadline before the phone stops calling it unconfirmed.
 *
 *  The receipt CONFIRMS; it must never retire the pending bubble. A mid-turn
 *  send's only transcript record is the `queued_command` attachment Orca drops,
 *  so a bubble retired on a receipt would have no row to replace it and would
 *  vanish — the 2026-09-13 defect. */
describe('the agent’s prompt receipt stops the unconfirmed clock', () => {
  let renderer: ReactTestRenderer | null = null
  let state: DraftState | null = null

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    state = null
    vi.useRealTimers()
    await clearNativeChatDraftStores()
  })

  function Harness({
    receipts,
    onUnconfirmedSendLanded
  }: {
    receipts?: readonly BeaconPromptReceipt[]
    onUnconfirmedSendLanded?: () => void
  }): null {
    state = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId: 'a',
      sessionId: 'session-a',
      messages: [],
      launchDraft: null,
      chatActive: true,
      transcriptLoading: false,
      transcriptSettled: true,
      ...(onUnconfirmedSendLanded ? { onUnconfirmedSendLanded } : {}),
      ...(receipts ? { beaconPromptReceipts: receipts } : {})
    })
    return null
  }

  async function holdSend(text: string, onUnconfirmed: () => void): Promise<void> {
    act(() => state?.setComposerText(text))
    const origin = state?.captureSendOrigin(text)
    expect(origin).not.toBeNull()
    await act(async () => {
      state?.holdUnconfirmedSend(origin!, text, onUnconfirmed)
    })
  }

  it('never surfaces the send as unconfirmed once the agent acknowledges it', async () => {
    const onUnconfirmed = vi.fn()
    await act(async () => {
      renderer = create(createElement(Harness, {}))
    })
    await holdSend('fix the login', onUnconfirmed)

    // The agent's hook beacons the text it accepted, about a second later.
    await act(async () => {
      renderer!.update(
        createElement(Harness, { receipts: [{ nonce: '1', text: 'fix the login' }] })
      )
    })
    // The 20s deadline passes; it must already have been cancelled.
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    expect(onUnconfirmed).not.toHaveBeenCalled()
  })

  /** The message-loss case the review caught. `desktopPrompts` is accumulated
   *  history, so an identical prompt from BEFORE the send is still in the list.
   *  A send whose ack was lost creates no pending bubble and clears the
   *  composer, so if that stale receipt cancels the notice the text is gone
   *  with nothing on screen to say so. */
  it('does not let a receipt older than the send cancel its unconfirmed notice', async () => {
    const onUnconfirmed = vi.fn()
    const older = [{ nonce: '100', text: 'continue' }]
    await act(async () => {
      renderer = create(createElement(Harness, { receipts: older }))
    })
    await holdSend('continue', onUnconfirmed)
    // A later, unrelated prompt makes the effect run again with the stale
    // receipt still in the list.
    await act(async () => {
      renderer!.update(
        createElement(Harness, { receipts: [...older, { nonce: '200', text: 'hello' }] })
      )
    })
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    expect(onUnconfirmed).toHaveBeenCalledTimes(1)
  })

  it('still reports unconfirmed when no receipt ever arrives', async () => {
    const onUnconfirmed = vi.fn()
    await act(async () => {
      renderer = create(createElement(Harness, {}))
    })
    await holdSend('fix the login', onUnconfirmed)
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    expect(onUnconfirmed).toHaveBeenCalledTimes(1)
  })

  it('does not let an unrelated receipt confirm the send', async () => {
    const onUnconfirmed = vi.fn()
    await act(async () => {
      renderer = create(createElement(Harness, {}))
    })
    await holdSend('fix the login', onUnconfirmed)
    await act(async () => {
      renderer!.update(createElement(Harness, { receipts: [{ nonce: '1', text: 'something else' }] }))
    })
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    expect(onUnconfirmed).toHaveBeenCalledTimes(1)
  })

  it('tells the view the send landed, so an earlier failure notice retires', async () => {
    const onLanded = vi.fn()
    await act(async () => {
      renderer = create(createElement(Harness, { onUnconfirmedSendLanded: onLanded }))
    })
    await holdSend('fix the login', vi.fn())
    await act(async () => {
      renderer!.update(
        createElement(Harness, {
          onUnconfirmedSendLanded: onLanded,
          receipts: [{ nonce: '1', text: 'fix the login' }]
        })
      )
    })
    expect(onLanded).toHaveBeenCalled()
  })

  /** The guard for the 2026-09-13 defect: confirming must not remove the
   *  pending bubble, which still leaves only on a transcript row. */
  it('leaves the pending bubble in place — it is a confirmation, not a retirement', async () => {
    await act(async () => {
      renderer = create(createElement(Harness, {}))
    })
    act(() => state?.setComposerText('fix the login'))
    const origin = state?.captureSendOrigin('fix the login')
    await act(async () => {
      state?.acceptSend(origin!, 'fix the login')
    })
    const pendingAfterSend = state?.pending.length ?? 0
    expect(pendingAfterSend).toBeGreaterThan(0)
    await act(async () => {
      renderer!.update(
        createElement(Harness, { receipts: [{ nonce: '1', text: 'fix the login' }] })
      )
    })
    expect(state?.pending.length).toBe(pendingAfterSend)
  })
})
