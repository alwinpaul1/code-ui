import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { useCodexChatCommandIntercept } from './use-codex-chat-command-intercept'

let renderer: ReactTestRenderer
let api: ReturnType<typeof useCodexChatCommandIntercept>
afterEach(() => act(() => renderer?.unmount()))
it('sends image captions through the original send with the shared deadline', async () => {
  const rawSendWithOutcome = vi.fn(async () => 'accepted' as const)
  function Harness() {
    api = useCodexChatCommandIntercept({
      agentRef: { current: 'codex' },
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
