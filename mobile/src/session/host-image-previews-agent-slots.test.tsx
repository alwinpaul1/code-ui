import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { resetHostImagePreviewCacheForTests, useHostImagePreviews } from './use-host-image-previews'
import { buildMobileNativeChatTransientData, foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { SEND_CALL_ID, SEND_FILE_TURN } from './fixtures/claude-send-user-file-2.1.296'

// One turn, two pictures from two records: a Read the host will not share (a
// scratchpad file, the usual case on Orca 1.4.224) and a SendUserFile of a
// file in the worktree, which it will. The view joins the records' previews
// in record order and places them by position. When the refused record had no
// entry at all, the sent picture slid into the Read's slot and was drawn as
// the picture the agent read, while the sent file showed the placeholder.

const READ_PATH = '/private/tmp/claude-501/scratchpad/logo/where.png'
const SENT_PATH = '/Users/alwinpaul/Desktop/Project/Code UI/mobile/assets/icon.png'
const STEP_ID = '790c0712-a09f-4359-9754-562f9f77ac86'

const turn: NativeChatMessage[] = SEND_FILE_TURN.map((message) => {
  const block = message.blocks[0]
  if (block?.type === 'tool-call' && block.name === 'Read') {
    return { ...message, blocks: [{ ...block, input: { file_path: READ_PATH } }] }
  }
  if (message.id === SEND_CALL_ID && block?.type === 'tool-call') {
    return { ...message, blocks: [{ ...block, input: { files: [SENT_PATH], caption: 'The launcher icon', status: 'normal', display: 'render' } }] }
  }
  return message
})

function hostClient(): RpcClient {
  const sendRequest = vi.fn(async (method: string, params: { pathText?: string }) => {
    if (method === 'files.resolveTerminalPath') {
      // Refused: the desktop answers a path it will not share with no target.
      return params.pathText === SENT_PATH
        ? { ok: true, result: { openTarget: { kind: 'worktree-file', relativePath: 'mobile/assets/icon.png' } } }
        : { ok: true, result: {} }
    }
    return { ok: true, result: { isBinary: true, isImage: true, mimeType: 'image/png', content: 'iVBORw0K' } }
  })
  return { sendRequest } as unknown as RpcClient
}

describe('pictures from two records of one turn', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    resetHostImagePreviewCacheForTests()
    vi.restoreAllMocks()
  })

  it('draws the sent picture in its own slot when the read one before it was refused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let previews: Record<string, string[]> = {}
    const client = hostClient()
    const terminalHandleRef = { current: 'term' }
    const local = {}
    function Probe() {
      previews = useHostImagePreviews({
        client,
        enabled: true,
        hostId: 'host',
        worktreeId: 'worktree',
        nativeChatContext: { tabId: 'tab', sessionId: 'session' },
        terminalHandleRef,
        messages: turn,
        localPreviews: local
      })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Probe))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const folded = foldMobileNativeChatMessages(turn)
    const step = buildMobileNativeChatTransientData({ messages: turn, folded, streaming: null, pending: [], imagePreviewsByMessageId: previews })
      .data.find((message) => message.id === STEP_ID)!
    const images = step.blocks.filter((block) => block.type === 'image-ref')
    expect(images).toEqual([
      { type: 'image-ref', path: READ_PATH, alt: 'Image the agent read' },
      { type: 'image-ref', path: SENT_PATH, url: 'data:image/png;base64,iVBORw0K', alt: 'Image the agent sent' }
    ])
  })
})
