import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileNativeChatImageMarkup } from './use-mobile-native-chat-image-markup'

const NOT_SAVED = 'Markup not saved — the photo is still attached without it'

/**
 * The markup editor's Done voids what this returns, so any exit that neither
 * swaps the chip nor says so leaves the unmarked photo to go out as if it had
 * been marked up. Second review (2026-09-25): chips sit in a module-level
 * store and outlive the host's client, so a Done with no client to upload
 * through is reachable, and it said nothing.
 */
describe('a markup Done that could not save says so', () => {
  let renderer: ReactTestRenderer | null = null
  let replace: ((id: string, base64: string) => Promise<void>) | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    replace = null
  })

  function mount(client: RpcClient | null, showToast: (message: string, ms?: number) => void) {
    const replaceAttachmentImage = vi.fn()
    function Probe(): null {
      replace = useMobileNativeChatImageMarkup({
        client,
        getActiveWorktreeConnectionId: async () => null,
        scopeKey: 'h\0w\0tab',
        replaceAttachmentImage,
        showToast
      })
      return null
    }
    act(() => {
      renderer = create(createElement(Probe))
    })
    return { replaceAttachmentImage }
  }

  it('says the markup was not saved when there is no connection to upload it through', async () => {
    const showToast = vi.fn()
    const { replaceAttachmentImage } = mount(null, showToast)

    await act(() => replace!('img-1', 'ZZZZ'))

    expect(replaceAttachmentImage).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledExactlyOnceWith(NOT_SAVED, 1500)
  })

  it('says the markup was not saved when the host refuses the upload', async () => {
    const showToast = vi.fn()
    const sendRequest = vi.fn(async () => ({
      id: 'save',
      ok: false,
      error: { code: 'failed', message: 'disk full' },
      _meta: { runtimeId: 'r' }
    }))
    const { replaceAttachmentImage } = mount({ sendRequest } as unknown as RpcClient, showToast)

    await act(() => replace!('img-1', 'ZZZZ'))

    expect(replaceAttachmentImage).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledExactlyOnceWith(NOT_SAVED, 1500)
  })
})
