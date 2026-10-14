import type { ReactNode } from 'react'
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'

// The chat with pictures only Anthropic's copy of the session holds, through
// the real hooks (use-ccr-session-images.ts → use-host-image-previews.ts →
// the view's render data → MobileNativeChatMessage), with a fake fetch that
// answers in the API's recorded shapes (fixtures/ccr-session-api-2026-10-14.ts).
// The user's report of 2026-10-14: the Claude app drew the pictures Claude
// Code read (codeui.png, claude.png) and the two screenshots pasted into a
// prompt; Code UI drew name chips and "Image on Desktop".

vi.mock('expo-secure-store', () => ({ setItemAsync: vi.fn(), getItemAsync: vi.fn(async () => null), deleteItemAsync: vi.fn() }))
vi.mock('expo-crypto', () => ({ getRandomBytes: vi.fn(), digestStringAsync: vi.fn() }))
vi.mock('expo-linking', () => ({ openURL: vi.fn() }))
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
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, flatten: (style: unknown) => style },
    Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default },
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
import { useCcrSessionImages } from './use-ccr-session-images'
import { resetCcrPipelineForTests, type CcrPipelineDeps } from './ccr-session-pipeline'
import { showAgentImage } from './agent-image-visibility'
import { ThemeProvider } from '../theme/theme-context'
import { READ_IMAGE_CALL_ID, READ_IMAGE_PATH, READ_IMAGE_RESULT_ID, READ_IMAGE_ROWS } from './fixtures/claude-agent-message-read-image-2.1.283'
import {
  JPEG_HEAD,
  ORG_UUID,
  ACCOUNT_UUID,
  PNG_1PX,
  SESSION_A,
  TOKEN,
  apiRoutes,
  assistantEvent,
  eventsReply,
  fakeFetch,
  imageBlock,
  pasteEvent,
  readResultEvent,
  reply,
  sessionRow,
  sessionsReply,
  systemEvent,
  type Route
} from './fixtures/ccr-session-api-2026-10-14'

const READ_TOOL_ID = 'toolu_01CbCVp2SjFhYsDs8MPXLyPT'
const PASTE_ID = 'd7245783-7183-4668-b62f-3630e6303da9'
const PNG_URI = `data:image/png;base64,${PNG_1PX}`
const JPEG_URI = `data:image/jpeg;base64,${JPEG_HEAD}`

const PASTE_ROW: NativeChatMessage = {
  id: PASTE_ID,
  role: 'user',
  timestamp: Date.parse('2026-10-14T16:00:00Z'),
  source: 'transcript',
  blocks: [{ type: 'text', text: '[Image #1] [Image #2] Fix this issue can\'t get a code' }]
}

/** The session as Anthropic holds it: the Read, its picture, the paste, and system noise. */
const sessionEvents = eventsReply([
  systemEvent('sys-1'),
  readResultEvent(READ_IMAGE_RESULT_ID, READ_TOOL_ID, [imageBlock(PNG_1PX)]),
  assistantEvent(READ_IMAGE_CALL_ID, READ_TOOL_ID, READ_IMAGE_PATH),
  pasteEvent(PASTE_ID, [imageBlock(JPEG_HEAD, 'image/jpeg'), imageBlock(PNG_1PX)]),
  systemEvent('sys-2')
])

const matchingRoutes = (): Route[] =>
  apiRoutes({ sessions: () => reply(200, sessionsReply([sessionRow(SESSION_A)])), events: { [SESSION_A]: () => reply(200, sessionEvents) } })

/** The desktop as it answers a scratchpad path no assistant text names: no target. */
function refusingDesktop(): RpcClient {
  return { sendRequest: vi.fn(async () => ({ ok: true, result: {} })) } as unknown as RpcClient
}

function depsFor(routes: Route[], token: string | null = TOKEN) {
  const { fetch, requests } = fakeFetch(routes)
  const lines: string[] = []
  const deps: CcrPipelineDeps = {
    fetch,
    readToken: async () => token,
    org: { read: async () => ({ accountUuid: ACCOUNT_UUID, organizationUuid: ORG_UUID }), write: async () => undefined, clear: async () => undefined },
    keep: (_key, uri) => uri,
    maxBytes: 8 * 1024 * 1024,
    log: (line) => lines.push(line)
  }
  return { deps, requests, lines }
}

let probe: ReactTestRenderer | null = null
let view: ReactTestRenderer | null = null

async function settle(): Promise<void> {
  for (let round = 0; round < 12; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/** The previews the chat would hold for these rows, through both hooks. */
async function previewsFor(messages: NativeChatMessage[], deps: CcrPipelineDeps, localPreviews: Record<string, string[]> = {}): Promise<() => Record<string, string[]>> {
  let previews: Record<string, string[]> = {}
  const client = refusingDesktop()
  const terminalHandleRef = { current: 'term' }
  function Probe() {
    const remote = useCcrSessionImages({ enabled: true, tabId: 'tab-1', messages, localPreviews, epoch: 1, deps })
    previews = useHostImagePreviews({
      client,
      enabled: true,
      hostId: 'host',
      worktreeId: 'worktree',
      nativeChatContext: { tabId: 'tab-1', sessionId: '211c47c2-7a42-4c86-9a59-eaa0905d39e6' },
      terminalHandleRef,
      messages,
      localPreviews,
      remote
    })
    return null
  }
  await act(async () => {
    probe = create(createElement(Probe))
  })
  await settle()
  return () => previews
}

function render(raw: NativeChatMessage[], previews: Record<string, string[]>, id: string, scheme: 'light' | 'dark'): ReactTestInstance {
  const folded = foldMobileNativeChatMessages(raw)
  const { data } = buildMobileNativeChatTransientData({ messages: raw, folded, streaming: null, pending: [], imagePreviewsByMessageId: previews })
  const message = data.find((row) => row.id === id)!
  act(() => {
    view?.unmount()
    view = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatMessage message={message} />
      </ThemeProvider>
    )
  })
  return view!.root
}

const imageUris = (root: ReactTestInstance) =>
  root.findAll((node) => (node.type as unknown) === 'Image').map((node) => (node.props.source as { uri?: string }).uri)
const labels = (root: ReactTestInstance) =>
  root.findAll((node) => typeof node.props.accessibilityLabel === 'string').map((node) => node.props.accessibilityLabel as string)

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => {
  act(() => {
    probe?.unmount()
    view?.unmount()
  })
  probe = null
  view = null
  resetHostImagePreviewCacheForTests()
  resetCcrPipelineForTests()
  vi.restoreAllMocks()
})

describe('a picture the agent read that the desktop will not share', () => {
  it.each(['light', 'dark'] as const)('becomes the picture from Anthropic in place of its chip (%s)', async (scheme) => {
    showAgentImage(READ_IMAGE_PATH)
    const { deps, requests } = depsFor(matchingRoutes())
    const previews = await previewsFor(READ_IMAGE_ROWS, deps)
    expect(previews()[READ_IMAGE_CALL_ID]).toEqual([PNG_URI])
    const root = render(READ_IMAGE_ROWS, previews(), READ_IMAGE_CALL_ID, scheme)
    expect(imageUris(root)).toEqual([PNG_URI])
    expect(labels(root).some((label) => label.startsWith('Image on Desktop: img39_1.jpeg'))).toBe(false)
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(['/v1/code/sessions', `/v1/code/sessions/${SESSION_A}/events`])
  })

  it('is not asked of Anthropic while its slot is off screen', async () => {
    const { deps, requests } = depsFor(matchingRoutes())
    await previewsFor(READ_IMAGE_ROWS, deps)
    expect(requests).toEqual([])
  })

  it.each(['light', 'dark'] as const)('stays the chip, with a line saying why, when the phone is not signed in (%s)', async (scheme) => {
    showAgentImage(READ_IMAGE_PATH)
    const { deps, requests, lines } = depsFor(matchingRoutes(), null)
    const previews = await previewsFor(READ_IMAGE_ROWS, deps)
    const root = render(READ_IMAGE_ROWS, previews(), READ_IMAGE_CALL_ID, scheme)
    expect(imageUris(root)).toEqual([])
    expect(labels(root).some((label) => label.startsWith('Image on Desktop: img39_1.jpeg'))).toBe(true)
    expect(requests).toEqual([])
    expect(lines.some((line) => line.startsWith('[ccr-images] sign-in: failed — not signed in to Anthropic on this phone'))).toBe(true)
  })

  it('stays the chip when no session shares a message with the tab', async () => {
    showAgentImage(READ_IMAGE_PATH)
    const { deps, lines } = depsFor(
      apiRoutes({ sessions: () => reply(200, sessionsReply([sessionRow(SESSION_A)])), events: { [SESSION_A]: () => reply(200, eventsReply([systemEvent('elsewhere')])) } })
    )
    const previews = await previewsFor(READ_IMAGE_ROWS, deps)
    const root = render(READ_IMAGE_ROWS, previews(), READ_IMAGE_CALL_ID, 'light')
    expect(imageUris(root)).toEqual([])
    expect(lines.some((line) => line.startsWith('[ccr-images] match: failed — none of 1 Remote Control session shares a message'))).toBe(true)
  })

  it('stays the chip when the API refuses the token', async () => {
    showAgentImage(READ_IMAGE_PATH)
    const { deps, lines } = depsFor(apiRoutes({ sessions: () => reply(401, {}) }))
    const previews = await previewsFor(READ_IMAGE_ROWS, deps)
    expect(previews()[READ_IMAGE_CALL_ID]).toEqual([''])
    expect(lines.some((line) => line.includes('sessions: failed — the sign-in was refused (HTTP 401)'))).toBe(true)
  })
})

describe('pictures pasted into a prompt on the desktop', () => {
  it.each(['light', 'dark'] as const)('draw as thumbnails in place of "Image on Desktop" (%s)', async (scheme) => {
    const { deps } = depsFor(matchingRoutes())
    const previews = await previewsFor([PASTE_ROW], deps)
    expect(previews()[PASTE_ID]).toEqual([JPEG_URI, PNG_URI])
    const root = render([PASTE_ROW], previews(), PASTE_ID, scheme)
    expect(imageUris(root)).toEqual([JPEG_URI, PNG_URI])
    expect(labels(root).some((label) => label.startsWith('Image on Desktop'))).toBe(false)
  })

  it.each(['light', 'dark'] as const)('stay "Image on Desktop" chips when nothing matches (%s)', async (scheme) => {
    const { deps } = depsFor(
      apiRoutes({ sessions: () => reply(200, sessionsReply([sessionRow(SESSION_A)])), events: { [SESSION_A]: () => reply(200, eventsReply([systemEvent('elsewhere')])) } })
    )
    const previews = await previewsFor([PASTE_ROW], deps)
    const root = render([PASTE_ROW], previews(), PASTE_ID, scheme)
    expect(imageUris(root)).toEqual([])
    expect(labels(root).filter((label) => label.startsWith('Image on Desktop')).length).toBe(2)
  })

  it('leave a message the phone holds its own previews for alone', async () => {
    const { deps, requests } = depsFor(matchingRoutes())
    const local = { [PASTE_ID]: ['file:///phone/photo.jpg'] }
    const previews = await previewsFor([PASTE_ROW], deps, local)
    expect(requests).toEqual([])
    expect(previews()[PASTE_ID]).toBeUndefined()
  })
})
