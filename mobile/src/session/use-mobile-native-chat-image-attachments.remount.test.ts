import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'

vi.mock('./mobile-image-source-picker', () => ({
  pickMobileImages: vi.fn(),
  ImageLibraryPermissionError: class ImageLibraryPermissionError extends Error {}
}))

import { pickMobileImages } from './mobile-image-source-picker'
import {
  baseArgs,
  makeClient,
  methodNotFound,
  ok,
  type Hook,
  type HookArgs
} from './use-mobile-native-chat-image-attachments.test-support'

const pick = vi.mocked(pickMobileImages)

// 2026-09-13: leaving the session screen (source control, another worktree)
// and coming back kept the typed text, which is on disk, but dropped the
// picked images, which lived in the unmounted screen's state.
describe('pending image chips across a session screen remount', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: Hook | null = null
  function Harness({ args }: { args: HookArgs }): null {
    hook = useMobileNativeChatImageAttachments(args)
    return null
  }
  const mount = (args: HookArgs): void => {
    act(() => {
      renderer = create(createElement(Harness, { args }))
    })
  }
  beforeEach(() => {
    pick.mockReset()
    useNativeChatImageAttachmentsStore.getState().reset()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
  })

  it('keeps the chips when the screen unmounts and mounts again', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///a.jpg' }])
    const client = makeClient([methodNotFound('start'), ok('save', '/tmp/a.png')])
    const args = baseArgs({ client: client as unknown as RpcClient, baseSend: vi.fn() })
    mount(args)
    await act(async () => {
      await hook!.attachImage('library')
    })
    expect(hook!.attachments).toHaveLength(1)

    act(() => renderer!.unmount())
    renderer = null
    mount(args)
    expect(hook!.attachments).toHaveLength(1)
  })
})
