import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'

vi.mock('../components/DraggableDetailSheet', () => ({ DraggableDetailSheet: () => null }))
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): unknown => React.createElement('Text', props, children)
  return {
    Animated: {
      View: 'View',
      Text,
      Value: class {
        constructor(private value: number) {}
        setValue(next: number): void {
          this.value = next
        }
      },
      loop: (animation: unknown) => animation,
      sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
      timing: () => ({ start: vi.fn(), stop: vi.fn() })
    },
    Image: 'Image',
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: ReactNode }) => React.createElement('ScrollView', props, children),
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) => React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 360, height: 780, scale: 3, fontScale: 1 })
  }
})
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Copy: 'Copy',
  Image: 'ImageIcon',
  Undo2: 'Undo2',
  Wrench: 'Wrench'
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))

import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { buildMobileNativeChatTransientData, foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { resetHostImagePreviewCacheForTests, useHostImagePreviews } from './use-host-image-previews'
import { AgentImageShareContext, useAgentImageShareAsks } from './agent-image-share-context'
import { resetShareAsksForTests, shareAskText } from './agent-image-share-ask'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import { ThemeProvider } from '../theme/theme-context'
import { colorsForScheme } from '../theme/tokens'
import { CHIPS_AFTER, CHIPS_BEFORE, CHIPS_PATH, CHIPS_RUN } from './fixtures/claude-agent-read-same-image-twice-2.1.296'
import { READ_IMAGE_PATH, READ_IMAGE_ROWS } from './fixtures/claude-agent-message-read-image-2.1.283'

// The lead's decision of 2026-10-13: a picture the desktop would not share
// (Orca 1.4.224 shares a scratchpad file only once the agent's TEXT names its
// path) offers one tap that asks the agent to write the path, through the
// composer's own send, and the phone's retry then fetches it. The run is the
// real one (Claude Code 2.1.296, session 3dec2e94): a scratchpad screenshot
// read twice, its path never named.

const SESSION = '3dec2e94-c429-4c34-af89-68c601b2d4ec'
const RAW = [CHIPS_BEFORE, ...CHIPS_RUN, CHIPS_AFTER]
const PICTURE = 'data:image/png;base64,iVBORw0K'
const at = (offset: number) => Date.parse('2026-10-13T12:31:00Z') + offset * 1000

const userRow = (id: string, text: string, offset: number): NativeChatMessage => ({
  id,
  role: 'user',
  timestamp: at(offset),
  source: 'transcript',
  blocks: [{ type: 'text', text }]
})
const reply = (id: string, text: string, offset: number): NativeChatMessage => ({
  id,
  role: 'assistant',
  timestamp: at(offset),
  source: 'transcript',
  blocks: [{ type: 'text', text }]
})

/** A second picture, a different file read in the same run, after the chips. */
const otherRead: NativeChatMessage[] = READ_IMAGE_ROWS.map((row) => ({ ...row, timestamp: (row.timestamp ?? 0) + Date.parse('2026-10-13T12:30:04Z') - Date.parse('2026-09-26T12:09:59Z') }))

/** The desktop's rule 1 as Orca 1.4.224 applies it: it shares a path once the
 *  session holds assistant text naming it in backticks; `gone` is a file the
 *  agent named that no longer exists (an empty resolution, as a refusal). */
function desktop(rows: () => NativeChatMessage[], gone = false) {
  const sendRequest = vi.fn(async (method: string, params: { pathText?: string }) => {
    if (method === 'files.resolveTerminalPath') {
      const named = rows().some((row) => row.role === 'assistant' && row.blocks.some((block) => block.type === 'text' && block.text.includes(`\`${params.pathText}\``)))
      return named && !gone
        ? { ok: true, result: { openTarget: { kind: 'absolute-file', absolutePath: params.pathText, grantId: 'grant' } } }
        : { ok: true, result: { worktree: 'worktree', relativePath: null, absolutePath: null, exists: false, isDirectory: false } }
    }
    return { ok: true, result: { isBinary: true, isImage: true, mimeType: 'image/png', content: 'iVBORw0K' } }
  })
  return { sendRequest } as unknown as RpcClient
}

type Style = Record<string, unknown>
const flat = (style: unknown): Style =>
  Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : style && typeof style === 'object' ? (style as Style) : {}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const LOCAL = {}

function Chat(props: {
  rows: NativeChatMessage[]
  client: RpcClient
  send: (text: string) => Promise<MobileNativeChatSendOutcome>
  agent?: string
  tabId?: string
  working?: boolean
  scheme?: 'light' | 'dark'
}) {
  const { rows, client, send, agent = 'claude', tabId = 'tab', working = false } = props
  const terminalHandleRef = { current: 'term' }
  const previews = useHostImagePreviews({
    client,
    enabled: true,
    hostId: 'host',
    worktreeId: 'worktree',
    nativeChatContext: { tabId, sessionId: SESSION },
    terminalHandleRef,
    messages: rows,
    localPreviews: LOCAL
  })
  const share = useAgentImageShareAsks({ tabId, sessionId: SESSION, agent, messages: rows, working, send })
  const folded = foldMobileNativeChatMessages(rows)
  const { data } = buildMobileNativeChatTransientData({ messages: rows, folded, streaming: null, pending: [], imagePreviewsByMessageId: previews })
  const turn = data.find((message) => message.id === rows[0]!.id)!
  return (
    <AgentImageShareContext.Provider value={share}>
      <MobileNativeChatMessage message={turn} />
    </AgentImageShareContext.Provider>
  )
}

describe('asking the agent to share a picture the desktop refused', () => {
  let renderer: ReactTestRenderer | null = null
  let rows: NativeChatMessage[] = RAW
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    rows = RAW
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    resetHostImagePreviewCacheForTests()
    resetShareAsksForTests()
    vi.restoreAllMocks()
  })

  async function mount(props: Omit<Parameters<typeof Chat>[0], 'rows'> & { rows?: NativeChatMessage[] }) {
    if (props.rows) {
      rows = props.rows
    }
    const draw = () => (
      <ThemeProvider initialPreference={props.scheme ?? 'light'}>
        <Chat {...props} rows={rows} />
      </ThemeProvider>
    )
    await act(async () => {
      renderer = create(draw())
      await settle()
    })
    return {
      root: () => renderer!.root,
      update: async (next: Partial<Parameters<typeof Chat>[0]>) => {
        if (next.rows) {
          rows = next.rows
        }
        await act(async () => {
          renderer!.update(
            <ThemeProvider initialPreference={props.scheme ?? 'light'}>
              <Chat {...props} {...next} rows={rows} />
            </ThemeProvider>
          )
          await settle()
        })
      }
    }
  }

  const pressables = (root: ReactTestInstance) => root.findAll((node) => (node.type as unknown) === 'Pressable')
  const chipOf = (root: ReactTestInstance, name: string) =>
    pressables(root).find((node) => typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith(`Image on Desktop: ${name}.`))
  const textOf = (node: ReactTestInstance) =>
    node.findAll((child) => (child.type as unknown) === 'Text').map((child) => [child.props.children].flat().join('')).join(' ')
  const askButtons = (root: ReactTestInstance) =>
    pressables(root).filter((node) => /^(Ask|Asked)/.test(textOf(node)))
  const lines = (root: ReactTestInstance) =>
    root.findAll((node) => (node.type as unknown) === 'Text').map((node) => [node.props.children].flat().join(''))
  const open = (root: ReactTestInstance, name = 'chips.png') => act(() => chipOf(root, name)!.props.onPress())
  const tile = (root: ReactTestInstance) =>
    root.findAll((node) => (node.type as unknown) === 'Image' && (node.props.source as { uri?: string } | undefined)?.uri === PICTURE)

  it('offers "Ask Claude to share it" under the refusal note, and sends nothing on its own', async () => {
    const send = vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'accepted')
    const chat = await mount({ client: desktop(() => rows), send })
    open(chat.root())
    expect(lines(chat.root()).some((line) => line.includes("The desktop didn't share this picture"))).toBe(true)
    expect(askButtons(chat.root()).map(textOf)).toEqual(['Ask Claude to share it'])
    expect(send).not.toHaveBeenCalled()
  })

  it('offers no ask while the desktop has not answered yet', async () => {
    const never = { sendRequest: vi.fn(() => new Promise(() => undefined)) } as unknown as RpcClient
    const chat = await mount({ client: never, send: vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'accepted') })
    open(chat.root())
    expect(lines(chat.root()).some((line) => line.includes('Waiting for the desktop'))).toBe(true)
    expect(askButtons(chat.root())).toEqual([])
  })

  it('offers no ask when the fetch itself failed', async () => {
    const failing = { sendRequest: vi.fn(async () => ({ ok: false, error: { code: 'timeout', message: 'request timed out' } })) } as unknown as RpcClient
    const chat = await mount({ client: failing, send: vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'accepted') })
    open(chat.root())
    expect(lines(chat.root()).some((line) => line.includes("couldn't be fetched"))).toBe(true)
    expect(askButtons(chat.root())).toEqual([])
  })

  it('names Codex on a Codex tab', async () => {
    const chat = await mount({ client: desktop(() => rows), send: vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'accepted'), agent: 'codex' })
    open(chat.root())
    expect(askButtons(chat.root()).map(textOf)).toEqual(['Ask Codex to share it'])
    act(() => askButtons(chat.root())[0]!.props.onPress())
    expect(askButtons(chat.root()).map(textOf)).toEqual(["Asked — waiting for Codex's reply"])
  })

  it('sends one line asking for the path in backticks, with the exact path the Read named', async () => {
    const send = vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'accepted')
    const chat = await mount({ client: desktop(() => rows), send })
    open(chat.root())
    await act(async () => {
      askButtons(chat.root())[0]!.props.onPress()
      await settle()
    })
    expect(send).toHaveBeenCalledTimes(1)
    const text = (send.mock.calls[0] as unknown as [string])[0]
    expect(text).toBe(
      `Please write the full path of chips.png in your reply, in backticks, so my phone can show it. It is \`${CHIPS_PATH}\`.`
    )
    expect(text.includes('\n')).toBe(false)
  })

  it('reads "Asked — waiting for Claude\'s reply" after the tap, and a second tap sends nothing', async () => {
    const send = vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'accepted')
    const chat = await mount({ client: desktop(() => rows), send })
    open(chat.root())
    await act(async () => {
      askButtons(chat.root())[0]!.props.onPress()
      await settle()
    })
    const asked = askButtons(chat.root())
    expect(asked.map(textOf)).toEqual(["Asked — waiting for Claude's reply"])
    await act(async () => {
      asked[0]!.props.onPress?.()
      await settle()
    })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('shows the 96 dp picture once the reply names the path in backticks (refusal, tap, send, reply, fetch, tile)', async () => {
    const send = vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'accepted')
    const chat = await mount({ client: desktop(() => rows), send })
    expect(tile(chat.root())).toEqual([])
    open(chat.root())
    await act(async () => {
      askButtons(chat.root())[0]!.props.onPress()
      await settle()
    })
    const asked = (send.mock.calls[0] as unknown as [string])[0]
    await chat.update({ rows: [...RAW, userRow('ask-1', asked, 1)], working: true })
    expect(askButtons(chat.root()).map(textOf)).toEqual(["Asked — waiting for Claude's reply"])
    await chat.update({ rows: [...RAW, userRow('ask-1', asked, 1), reply('reply-1', `It is \`${CHIPS_PATH}\`.`, 2)], working: false })
    const shown = tile(chat.root())
    expect(shown).toHaveLength(1)
    expect(flat(shown[0]!.props.style).width).toBe(96)
    expect(chipOf(chat.root(), 'chips.png')).toBeUndefined()
  })

  it('offers the ask again once, when the reply lands without naming the path, and then not again', async () => {
    const send = vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'accepted')
    const chat = await mount({ client: desktop(() => rows), send })
    open(chat.root())
    await act(async () => {
      askButtons(chat.root())[0]!.props.onPress()
      await settle()
    })
    const text = shareAskText(CHIPS_PATH)
    const firstRound = [...RAW, userRow('ask-1', text, 1), reply('reply-1', 'The screenshot is chips.png in the scratchpad (chk folder).', 2)]
    await chat.update({ rows: firstRound, working: false })
    expect(askButtons(chat.root()).map(textOf)).toEqual(['Ask Claude to share it'])
    await act(async () => {
      askButtons(chat.root())[0]!.props.onPress()
      await settle()
    })
    expect(send).toHaveBeenCalledTimes(2)
    await chat.update({ rows: [...firstRound, userRow('ask-2', text, 3)], working: true })
    expect(askButtons(chat.root()).map(textOf)).toEqual(["Asked — waiting for Claude's reply"])
    await chat.update({ rows: [...firstRound, userRow('ask-2', text, 3), reply('reply-2', `(${CHIPS_PATH})`, 4)], working: false })
    expect(askButtons(chat.root())).toEqual([])
    expect(lines(chat.root()).some((line) => line.includes("The desktop didn't share this picture"))).toBe(true)
  })

  it('keeps waiting while the agent is still answering, even after a first line that does not name the path', async () => {
    const send = vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'accepted')
    const chat = await mount({ client: desktop(() => rows), send })
    open(chat.root())
    await act(async () => {
      askButtons(chat.root())[0]!.props.onPress()
      await settle()
    })
    const text = shareAskText(CHIPS_PATH)
    await chat.update({ rows: [...RAW, userRow('ask-1', text, 1), reply('reply-1', 'Sure, here it is:', 2)], working: true })
    expect(askButtons(chat.root()).map(textOf)).toEqual(["Asked — waiting for Claude's reply"])
  })

  // Opus review (2026-10-13): Claude Code records most prompts taken mid-turn
  // as `queued_command` attachments, which Orca's reader drops, so an ask sent
  // while the agent works usually never becomes a user row.
  it('brings the ask back once a busy agent finishes without naming the path, though its queued ask never became a row', async () => {
    const send = vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'accepted')
    const chat = await mount({ client: desktop(() => rows), send, working: true })
    open(chat.root())
    await act(async () => {
      askButtons(chat.root())[0]!.props.onPress()
      await settle()
    })
    await chat.update({ rows: [...RAW, reply('reply-1', 'The tablet build is installed.', 1)], working: true })
    expect(askButtons(chat.root()).map(textOf)).toEqual(["Asked — waiting for Claude's reply"])
    await chat.update({ working: false })
    expect(askButtons(chat.root()).map(textOf)).toEqual(['Ask Claude to share it'])
  })

  it('stays asked while nothing has come back since the tap', async () => {
    const send = vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'unknown')
    const chat = await mount({ client: desktop(() => rows), send })
    open(chat.root())
    await act(async () => {
      askButtons(chat.root())[0]!.props.onPress()
      await settle()
    })
    await chat.update({ working: false })
    expect(askButtons(chat.root()).map(textOf)).toEqual(["Asked — waiting for Claude's reply"])
  })

  it('offers the ask again when the send is refused', async () => {
    const send = vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'rejected')
    const chat = await mount({ client: desktop(() => rows), send })
    open(chat.root())
    await act(async () => {
      askButtons(chat.root())[0]!.props.onPress()
      await settle()
    })
    expect(askButtons(chat.root()).map(textOf)).toEqual(['Ask Claude to share it'])
  })

  it('offers the ask again when the send throws', async () => {
    const send = vi.fn(async (): Promise<MobileNativeChatSendOutcome> => {
      throw new Error('relay closed')
    })
    const chat = await mount({ client: desktop(() => rows), send })
    open(chat.root())
    await act(async () => {
      askButtons(chat.root())[0]!.props.onPress()
      await settle()
    })
    expect(askButtons(chat.root()).map(textOf)).toEqual(['Ask Claude to share it'])
  })

  it('stays asked when the outbox holds the message for the desktop', async () => {
    const send = vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'unknown')
    const chat = await mount({ client: desktop(() => rows), send })
    open(chat.root())
    await act(async () => {
      askButtons(chat.root())[0]!.props.onPress()
      await settle()
    })
    expect(askButtons(chat.root()).map(textOf)).toEqual(["Asked — waiting for Claude's reply"])
  })

  it('says the picture could not be fetched when the reply names a file that is gone', async () => {
    const send = vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'accepted')
    const chat = await mount({ client: desktop(() => rows, true), send })
    open(chat.root())
    await act(async () => {
      askButtons(chat.root())[0]!.props.onPress()
      await settle()
    })
    const text = shareAskText(CHIPS_PATH)
    await chat.update({ rows: [...RAW, userRow('ask-1', text, 1), reply('reply-1', `\`${CHIPS_PATH}\``, 2)], working: false })
    expect(lines(chat.root()).some((line) => line.includes("couldn't be fetched"))).toBe(true)
    expect(askButtons(chat.root())).toEqual([])
    expect(tile(chat.root())).toEqual([])
  })

  it('keeps an ask to the tab it was sent from when the tab switches mid-ask', async () => {
    let finish: (outcome: MobileNativeChatSendOutcome) => void = () => undefined
    const send = vi.fn(() => new Promise<MobileNativeChatSendOutcome>((resolve) => { finish = resolve }))
    const chat = await mount({ client: desktop(() => rows), send, tabId: 'tab-a' })
    open(chat.root())
    act(() => askButtons(chat.root())[0]!.props.onPress())
    expect(askButtons(chat.root()).map(textOf)).toEqual(["Asked — waiting for Claude's reply"])
    await chat.update({ tabId: 'tab-b' })
    expect(askButtons(chat.root()).map(textOf)).toEqual(['Ask Claude to share it'])
    await act(async () => {
      finish('accepted')
      await settle()
    })
    await chat.update({ tabId: 'tab-a' })
    expect(askButtons(chat.root()).map(textOf)).toEqual(["Asked — waiting for Claude's reply"])
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('sends one message per tap for two refused pictures in one run, each for its own file', async () => {
    const send = vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'accepted')
    const twoPictures = [...RAW.slice(0, -1), ...otherRead, CHIPS_AFTER]
    const chat = await mount({ client: desktop(() => rows), send, rows: twoPictures })
    open(chat.root(), 'chips.png')
    open(chat.root(), 'img39_1.jpeg')
    expect(askButtons(chat.root()).map(textOf)).toEqual(['Ask Claude to share it', 'Ask Claude to share it'])
    await act(async () => {
      askButtons(chat.root())[0]!.props.onPress()
      await settle()
    })
    expect(askButtons(chat.root()).map(textOf)).toEqual(["Asked — waiting for Claude's reply", 'Ask Claude to share it'])
    await act(async () => {
      askButtons(chat.root())[1]!.props.onPress()
      await settle()
    })
    expect(send.mock.calls.map((call) => (call as unknown as [string])[0])).toEqual([shareAskText(CHIPS_PATH), shareAskText(READ_IMAGE_PATH)])
  })

  // claude-in-chrome `computer` screenshot, as Claude Code 2.1.296 recorded it
  // on this machine: the picture rode only as base64 in the result.
  it.each(['light', 'dark'] as const)('says a screenshot was never saved as a file, and offers no ask (%s)', async (scheme) => {
    const shot: NativeChatMessage[] = [
      CHIPS_BEFORE,
      { id: 'shot-call', role: 'assistant', timestamp: at(1), source: 'transcript', blocks: [{ type: 'tool-call', name: 'mcp__claude-in-chrome__computer', input: { action: 'screenshot', tabId: 1376040020, scale: 0.6 }, callId: 'toolu_shot' } as NativeChatMessage['blocks'][number]] },
      { id: 'shot-result', role: 'tool', timestamp: at(2), source: 'transcript', blocks: [{ type: 'tool-result', output: 'Successfully captured screenshot (891x487, jpeg) - ID: ss_79511n8oq', callId: 'toolu_shot' } as NativeChatMessage['blocks'][number]] },
      reply('shot-after', 'The page is up.', 3)
    ]
    const chat = await mount({ client: desktop(() => rows), send: vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'accepted'), rows: shot, scheme })
    const chip = pressables(chat.root()).find((node) => typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith('Screenshot on Desktop'))
    expect(chip).toBeDefined()
    expect(textOf(chip!)).toBe('Screenshot')
    act(() => chip!.props.onPress())
    const note = chat.root().findAll((node) => (node.type as unknown) === 'Text').find((node) => [node.props.children].flat().join('') === "This screenshot was never saved as a file, so the phone can't show it.")
    expect(note).toBeDefined()
    expect(flat(note!.props.style).color).toBe(colorsForScheme(scheme).textSecondary)
    expect(askButtons(chat.root())).toEqual([])
  })

  it.each(['light', 'dark'] as const)('draws the ask in the theme’s accent text, and the waiting line muted (%s)', async (scheme) => {
    const send = vi.fn(async (): Promise<MobileNativeChatSendOutcome> => 'accepted')
    const chat = await mount({ client: desktop(() => rows), send, scheme })
    open(chat.root())
    const label = (node: ReactTestInstance) => node.find((child) => (child.type as unknown) === 'Text')
    expect(flat(label(askButtons(chat.root())[0]!).props.style).color).toBe(colorsForScheme(scheme).accentText)
    await act(async () => {
      askButtons(chat.root())[0]!.props.onPress()
      await settle()
    })
    expect(flat(label(askButtons(chat.root())[0]!).props.style).color).toBe(colorsForScheme(scheme).textMuted)
  })
})
