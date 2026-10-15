/** Second review of the attachment lane (2026-10-15): a send with chips on a tab whose target is refused for a lasting
 *  reason (the session belongs to another account) says THAT reason, not "isn't known yet, try
 *  again in a moment". */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ccrAttachmentLane } from './use-ccr-attachment-lane'
import { CCR_SEND_REFUSALS } from './use-ccr-composer-send'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { useNativeChatAnthropicSend } from './use-native-chat-anthropic-send'
import type { CcrSendTarget } from './ccr-session-cache'

const SCOPE = 'h\0w\0tab-1'
let renderer: ReactTestRenderer | null = null
afterEach(() => { act(() => renderer?.unmount()); renderer = null; useNativeChatImageAttachmentsStore.getState().reset() })

describe('a send with chips on a tab whose target is refused', () => {
  it('a photo send to a session of another account names that account mismatch, not a moment-later retry', async () => {
    useNativeChatImageAttachmentsStore.getState().update((prev) => ({ ...prev, [SCOPE]: [{ id: 'img-1', path: '', previewUri: 'file:///a.jpg', anthropicFile: { fileId: 'file_011CA', fileName: 'a.jpg', isImage: true, accountId: 'acct-personal' } }] }))
    const onSendError = vi.fn()
    const resolveTarget = (): CcrSendTarget => ({ kind: 'refused', reason: 'other-account' })
    // The composer send's own refusal (use-ccr-composer-send.ts target()).
    const lane = ccrAttachmentLane({ enabled: true, resolveTarget, upload: vi.fn(), send: async () => { onSendError(CCR_SEND_REFUSALS['other-account']); return 'rejected' } })!
    let send!: (text: string) => Promise<boolean>
    function Harness(): null {
      send = useNativeChatAnthropicSend({ anthropic: lane, scopeKey: SCOPE, onSendError, takeSentAttachments: vi.fn(), restoreSentAttachments: vi.fn() })
      return null
    }
    act(() => { renderer = create(createElement(Harness)) })
    await act(async () => { await send('look') })
    expect(onSendError).toHaveBeenCalledExactlyOnceWith(CCR_SEND_REFUSALS['other-account'])
  })
})
