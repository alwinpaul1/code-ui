import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import {
  agentShareName,
  lockedShareAskSend,
  SHARE_ASK_BUSY,
  shareAskText,
  textNamesPathCleanly
} from './agent-image-share-ask'
import { AGENT_UNSAVED_SCREENSHOT_ALT, placeAgentImages } from './mobile-native-chat-agent-images'
import { classifyMobileNativeChatSend } from './mobile-native-chat-send-classification'
import {
  acquireMobileNativeChatTerminalWrite,
  releaseMobileNativeChatTerminalWrite
} from './mobile-native-chat-terminal-write-lock'
import { CHIPS_PATH } from './fixtures/claude-agent-read-same-image-twice-2.1.296'

describe('the words the ask sends', () => {
  it('is typed as a chat message, not a command, for Claude and for Codex', () => {
    // Each agent's send classifies the text first; a command would skip the
    // outbox and the echo, and never be answered as a turn.
    expect(classifyMobileNativeChatSend('claude', shareAskText(CHIPS_PATH))).toBe('chat')
    expect(classifyMobileNativeChatSend('codex', shareAskText(CHIPS_PATH))).toBe('chat')
  })

  it('names the agent the tab runs, and says "the agent" for one it does not know', () => {
    expect(agentShareName('claude')).toBe('Claude')
    expect(agentShareName('codex')).toBe('Codex')
    expect(agentShareName(null)).toBe('the agent')
    expect(agentShareName('not-an-agent')).toBe('the agent')
  })

  it('stays one line for a path that holds a line break', () => {
    expect(shareAskText('/tmp/a\nb.png').includes('\n')).toBe(false)
  })
})

// Orca 1.4.224's boundary rule (terminal-output-path-candidates.ts): which
// replies make the desktop share the file.
describe('a reply that names the path the way the desktop accepts it', () => {
  const path = CHIPS_PATH
  it.each([
    [`\`${path}\``, true],
    [`"${path}"`, true],
    [`It is ${path}.`, true],
    [`${path}`, true],
    [`(${path})`, false],
    [`[chips](${path})`, false],
    [`${path}x`, false],
    ['nothing here', false]
  ])('%s → %s', (text, named) => {
    expect(textNamesPathCleanly(text, path)).toBe(named)
  })
  it('never matches an empty path', () => {
    expect(textNamesPathCleanly('anything', '')).toBe(false)
  })
})

// A defect of structure, with no behavioural handle the controller suite can
// reach (it draws no screen, and Claude's write verifies against one): which
// send the ask goes through. The composer's text send is the one with the
// outbox, the echo and the queue; a card-answer send would skip all three.
describe('the chat wiring of the ask', () => {
  const code = (file: string) =>
    readFileSync(join(import.meta.dirname, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')

  it('hands the placeholders the composer text send, under the write lock, on the terminal lane only', () => {
    const controller = code('use-mobile-native-chat-controller.ts')
    expect(controller).toMatch(/shareSendRef\.current = \{ send: handleNativeChatSendWithOutcome,/)
    expect(controller).toMatch(/lockedShareAskSend\(\{ handleRef: activeHandleRef, send: \(text\) => shareSendRef\.current\.send\(text\)/)
    expect(controller).toMatch(/useAgentImageShareAsks\(\{[^\n]*send: !activeChatStructured && activeChatResolution != null \? shareAskSend : null \}\)/)
    expect(controller).toMatch(/^\s*chatImagePreviewsByMessageId, nativeChatImageShare,$/m)
  })

  it('gives the chat rows the ask through the overlay box', () => {
    expect(code('MobileNativeChatOverlay.tsx')).toMatch(/<AgentImageShareView share=\{controller\.nativeChatImageShare \?\? null\}/)
  })
})

describe('the ask while another input holds the terminal', () => {
  afterEach(() => releaseMobileNativeChatTerminalWrite('term'))

  it('is refused with a reason, and nothing is typed', async () => {
    const send = vi.fn(async () => 'accepted' as const)
    const onSendError = vi.fn()
    expect(acquireMobileNativeChatTerminalWrite('term')).toBe(true)
    const ask = lockedShareAskSend({ handleRef: { current: 'term' }, send, onSendError })
    expect(await ask('words')).toBe('rejected')
    expect(send).not.toHaveBeenCalled()
    expect(onSendError).toHaveBeenCalledWith(SHARE_ASK_BUSY)
  })

  it('lets the next input through once it is done, even when the send threw', async () => {
    const ask = lockedShareAskSend({
      handleRef: { current: 'term' },
      send: async () => {
        throw new Error('relay closed')
      },
      onSendError: vi.fn()
    })
    await expect(ask('words')).rejects.toThrow('relay closed')
    expect(acquireMobileNativeChatTerminalWrite('term')).toBe(true)
  })
})

// Shapes as Claude Code recorded them on this machine: claude-in-chrome
// `computer` screenshot (2.1.289, 2.1.296) and chrome-devtools take_screenshot
// with no filePath (2.1.226). Each result carried the picture only as a base64
// `image` item, which Orca's reader drops; no file was ever written.
describe('a screenshot that was never saved as a file', () => {
  const call = (name: string, input: Record<string, unknown>, callId: string): NativeChatBlock =>
    ({ type: 'tool-call', name, input, callId }) as NativeChatBlock
  const result = (callId: string, isError = false): NativeChatBlock =>
    ({ type: 'tool-result', output: isError ? "Can't interact with browser-internal or unparseable URLs." : 'Successfully captured screenshot (891x487, jpeg)', callId, ...(isError ? { isError } : {}) }) as NativeChatBlock
  const words: NativeChatBlock = { type: 'text', text: 'The page is up.' }
  const unsaved = (blocks: NativeChatBlock[]) => blocks.filter((block) => block.type === 'image-ref' && block.alt === AGENT_UNSAVED_SCREENSHOT_ALT)

  it('gets a note slot after a claude-in-chrome screenshot, with no path to ask for', () => {
    const blocks = placeAgentImages([call('mcp__claude-in-chrome__computer', { action: 'screenshot', tabId: 1376040020, scale: 0.6 }, 'c1'), result('c1'), words], undefined)
    expect(unsaved(blocks)).toEqual([{ type: 'image-ref', alt: AGENT_UNSAVED_SCREENSHOT_ALT }])
    expect(blocks.indexOf(unsaved(blocks)[0]!)).toBeLessThan(blocks.indexOf(words))
  })

  it('gets a note slot after a chrome-devtools screenshot taken without a file path', () => {
    const blocks = placeAgentImages([call('mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot', { format: 'png' }, 'c1'), result('c1'), words], [])
    expect(unsaved(blocks)).toHaveLength(1)
  })

  it('gets none when chrome-devtools saved it to a file, or for a click', () => {
    const saved = placeAgentImages([call('mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot', { filePath: '/tmp/page.png' }, 'c1'), result('c1')], [])
    const click = placeAgentImages([call('mcp__claude-in-chrome__computer', { action: 'left_click', coordinate: [10, 10] }, 'c2'), result('c2')], [])
    expect(unsaved(saved)).toEqual([])
    expect(unsaved(click)).toEqual([])
  })

  it('gets none when the screenshot failed', () => {
    const blocks = placeAgentImages([call('mcp__claude-in-chrome__computer', { action: 'screenshot', tabId: 1 }, 'c1'), result('c1', true)], [])
    expect(unsaved(blocks)).toEqual([])
  })

  it('gets one slot for a run of screenshots, and leaves every picture the host sends in its own slot', () => {
    const blocks = placeAgentImages(
      [
        call('mcp__claude-in-chrome__computer', { action: 'screenshot', tabId: 1 }, 'c1'),
        result('c1'),
        call('Read', { file_path: CHIPS_PATH }, 'c2'),
        result('c2'),
        call('mcp__claude-in-chrome__computer', { action: 'screenshot', tabId: 1 }, 'c3'),
        result('c3'),
        words
      ],
      ['file:///cache/chips.png']
    )
    expect(blocks.filter((block) => block.type === 'image-ref')).toEqual([
      { type: 'image-ref', alt: AGENT_UNSAVED_SCREENSHOT_ALT },
      { type: 'image-ref', path: CHIPS_PATH, url: 'file:///cache/chips.png', alt: 'Image the agent read' }
    ])
  })
})
