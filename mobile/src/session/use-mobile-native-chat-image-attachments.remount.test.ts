import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
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

// Claude app, 2026-09-13: while a heavy file uploads its chip is already there
// with a ring, and the finished upload takes that chip's place.
describe('a chip while its upload is in flight', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: Hook | null = null
  function Harness({ args }: { args: HookArgs }): null {
    hook = useMobileNativeChatImageAttachments(args)
    return null
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

  it('shows the chip as uploading until the host has the bytes, then as a plain chip', async () => {
    pick.mockResolvedValue([{ base64: 'AAAA', uri: 'file:///big.mp4', name: 'big.mp4' }])
    let finishSave: (value: RpcResponse) => void = () => {}
    const save = new Promise<RpcResponse>((resolve) => {
      finishSave = resolve
    })
    const client = makeClient([methodNotFound('start'), save])
    act(() => {
      renderer = create(
        createElement(Harness, {
          args: baseArgs({ client: client as unknown as RpcClient, baseSend: vi.fn() })
        })
      )
    })
    let attach: Promise<void> = Promise.resolve()
    await act(async () => {
      attach = hook!.attachImage('library')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(hook!.attachments).toMatchObject([{ name: 'big.mp4', uploading: true, path: '' }])
    await act(async () => {
      finishSave(ok('save', '/tmp/big.png'))
      await attach
    })
    expect(hook!.attachments).toMatchObject([{ name: 'big.mp4', path: '/tmp/big.png' }])
    expect(hook!.attachments[0]?.uploading).toBeUndefined()
  })
})
