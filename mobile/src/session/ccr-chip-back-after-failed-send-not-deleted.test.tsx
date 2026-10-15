/** Second review of the attachment lane (2026-10-15): a send with a file whose POST the phone saw fail may still have
 *  reached the session (a timeout after the server took it; its echo comes later). Its chip comes
 *  back to the strip; removing it then must not delete the file that message may reference. */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setCcrFileDiscardForTests } from './ccr-file-discard'
import type { CcrUploadedFile } from './ccr-file-upload'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { useNativeChatAnthropicSend, type NativeChatAnthropicAttachments } from './use-native-chat-anthropic-send'
import { useNativeChatAttachmentScopeWriters } from './use-native-chat-attachment-scope-writers'

const SCOPE = 'h\0w\0tab-1'
let renderer: ReactTestRenderer | null = null
afterEach(() => { act(() => renderer?.unmount()); renderer = null; useNativeChatImageAttachmentsStore.getState().reset(); setCcrFileDiscardForTests(null) })

describe('a Claude tab chip that a rejected send carried', () => {
  it('a chip put back after a send the phone saw fail is not deleted at Anthropic when removed', async () => {
    const discarded: CcrUploadedFile[] = []
    setCcrFileDiscardForTests({ remove: async (f) => { discarded.push(f); return 200 }, log: () => undefined })
    useNativeChatImageAttachmentsStore.getState().update((prev) => ({ ...prev, [SCOPE]: [{ id: 'img-1', path: '', previewUri: 'file:///a.jpg', anthropicFile: { fileId: 'file_011CA', fileName: 'a.jpg', isImage: true, accountId: 'acct-personal' } }] }))
    // The POST timed out after the server took it: rejected on the phone.
    const lane: NativeChatAnthropicAttachments = { store: () => null, account: () => ({ accountId: 'acct-personal' }), send: async () => 'rejected' }
    let send!: (text: string) => Promise<boolean>
    let writers!: ReturnType<typeof useNativeChatAttachmentScopeWriters>
    function Harness(): null {
      writers = useNativeChatAttachmentScopeWriters(() => undefined)
      send = useNativeChatAnthropicSend({ anthropic: lane, scopeKey: SCOPE, onSendError: vi.fn(), takeSentAttachments: writers.takeSentAttachments, restoreSentAttachments: writers.restoreSentAttachments })
      return null
    }
    act(() => { renderer = create(createElement(Harness)) })
    await act(async () => { await send('look') })
    expect(useNativeChatImageAttachmentsStore.getState().byScope[SCOPE]?.map((c) => c.id)).toEqual(['img-1'])
    await act(async () => { writers.removeScopeAttachment(SCOPE, 'img-1'); await new Promise((r) => setTimeout(r, 0)) })
    expect(discarded).toEqual([])
  })
})
