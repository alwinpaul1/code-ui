import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { useCodexChatCommandIntercept } from './use-codex-chat-command-intercept'

let renderer: ReactTestRenderer
let api: ReturnType<typeof useCodexChatCommandIntercept>
const cleared = vi.fn()
afterEach(() => act(() => renderer?.unmount()))
it('sends image captions through the original send with the shared deadline', async () => {
  const rawSendWithOutcome = vi.fn(async () => 'accepted' as const)
  function Harness() {
    api = useCodexChatCommandIntercept({
      agentRef: { current: 'codex' },
      captureSendOrigin: (text: string) => ({ text }) as never,
      clearDraftForSend: (_origin: never, text: string) => cleared(text),
      sessionOptions: null,
      rawSendWithOutcome
    })
    return null
  }
  await act(async () => {
    renderer = create(createElement(Harness))
  })
  await act(async () => {
    await api.handleNativeChatSendWithOutcome('/model', ['file:///photo.jpg'], 12345)
  })
  expect(rawSendWithOutcome).toHaveBeenCalledExactlyOnceWith('/model', ['file:///photo.jpg'], 12345)
  expect(api.modelSheetRequest).toBe(0)
  await act(async () => {
    await api.handleNativeChatSendWithOutcome('/model')
  })
  expect(api.modelSheetRequest).toBe(1)
  expect(rawSendWithOutcome).toHaveBeenCalledOnce()
})

// 2026-09-13: `/model` opened the sheet but stayed in the composer, and glued
// itself to the front of the next message that was sent.
it('empties the composer when it takes a slash command instead of sending it', async () => {
  cleared.mockClear()
  const rawSendWithOutcome = vi.fn(async () => 'accepted' as const)
  function Harness() {
    api = useCodexChatCommandIntercept({
      agentRef: { current: 'codex' },
      captureSendOrigin: (text: string) => ({ text }) as never,
      clearDraftForSend: (_origin: never, text: string) => cleared(text),
      sessionOptions: null,
      rawSendWithOutcome
    })
    return null
  }
  await act(async () => {
    renderer = create(createElement(Harness))
  })
  await act(async () => {
    await api.handleNativeChatSendWithOutcome('/model')
  })
  expect(cleared).toHaveBeenCalledWith('/model')
  expect(rawSendWithOutcome).not.toHaveBeenCalled()
})
