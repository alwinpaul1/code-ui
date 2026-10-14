import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
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
import { peekImagePreview, resetImagePreviewForTests } from './image-preview-store'
import { ThemeProvider } from '../theme/theme-context'
import { colorsForScheme } from '../theme/tokens'
import { BETWEEN, LEAD, ROWS_PATH, ROWS_RUN, SHEET_PATH, SHEET_RUN } from './fixtures/claude-read-sheet-rows-2.1.296'

// The user's screenshot of 2026-10-14: under "Ran 2 commands, read 2 files"
// the phone drew two chips, `sheet.png` and `rows.png`, where the Claude app
// draws the pictures. The transcript holds each picture as base64, and Orca
// 1.4.224's reader drops it, so the phone asks the desktop for the file the
// Read named (files.resolveTerminalPath, then a preview read). These tests
// drive that path end to end: the hook that asks, and the chat that draws.

const PNG = 'iVBORw0KGgo='
const DATA = `data:image/png;base64,${PNG}`

type Reply = { ok: boolean; result?: unknown; error?: { code: string; message: string } }
type Answer = (method: string, params: Record<string, unknown>) => Reply | Promise<Reply>

function desktop(answer: Answer) {
  const sendRequest = vi.fn(async (method: string, params: Record<string, unknown>) => answer(method, params))
  return { client: { sendRequest } as unknown as RpcClient, sendRequest }
}

/** Orca sharing an outside-the-workspace file on a grant, then its preview. */
const sharing: Answer = (method, params) =>
  method === 'files.resolveTerminalPath'
    ? { ok: true, result: { worktree: 'wt', openTarget: { kind: 'absolute-file', absolutePath: params.pathText, grantId: 'g1' } } }
    : { ok: true, result: { isBinary: true, isImage: true, mimeType: 'image/png', content: PNG } }

/** Orca refusing it: no rule vouches for the path (the screenshot's case). */
const refusing: Answer = () => ({ ok: true, result: { worktree: 'wt', relativePath: null, absolutePath: null, exists: false, isDirectory: false } })

/** A desktop that has not answered yet. */
const silent: Answer = () => new Promise<Reply>(() => undefined)

const settle = async () => {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** The controller's hook feeding the view, as use-mobile-native-chat-controller
 *  and the chat list wire them. `shown` is whether the turn's row is mounted. */
function Chat({ client, rows, shown }: { client: RpcClient; rows: NativeChatMessage[]; shown: boolean }) {
  const previews = useHostImagePreviews({
    client,
    enabled: true,
    hostId: 'host',
    worktreeId: 'wt',
    nativeChatContext: { tabId: 'tab', sessionId: '211c47c2-7a42-4c86-9a59-eaa0905d39e6' },
    terminalHandleRef: { current: 'term' },
    messages: rows,
    localPreviews: {}
  })
  if (!shown) {
    return null
  }
  const folded = foldMobileNativeChatMessages(rows)
  const { data } = buildMobileNativeChatTransientData({ messages: rows, folded, streaming: null, pending: [], imagePreviewsByMessageId: previews })
  return data.map((message) => createElement(MobileNativeChatMessage, { key: message.id, message }))
}

let renderer: ReactTestRenderer | null = null
let warn: MockInstance<typeof console.warn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  resetHostImagePreviewCacheForTests()
  resetImagePreviewForTests()
  vi.restoreAllMocks()
})

async function mount(props: { client: RpcClient; rows: NativeChatMessage[]; shown?: boolean }, scheme: 'light' | 'dark' = 'light') {
  const tree = (shown: boolean) => (
    <ThemeProvider initialPreference={scheme}>
      <Chat client={props.client} rows={props.rows} shown={shown} />
    </ThemeProvider>
  )
  await act(async () => {
    renderer = create(tree(props.shown ?? true))
    await settle()
  })
  return {
    root: () => renderer!.root,
    show: async () => {
      await act(async () => {
        renderer!.update(tree(true))
        await settle()
      })
    }
  }
}

type Style = Record<string, unknown>
const flat = (style: unknown): Style =>
  Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : style && typeof style === 'object' ? (style as Style) : {}
const images = (root: ReactTestInstance) => root.findAll((node) => (node.type as unknown) === 'Image').map((node) => (node.props.source as { uri?: string }).uri)
const labelled = (root: ReactTestInstance, label: string) => root.findAll((node) => node.props.accessibilityLabel === label)
const loadingTiles = (root: ReactTestInstance) => root.findAll((node) => node.props.testID === 'agent-image-loading-tile' && typeof node.type === 'string')
const texts = (root: ReactTestInstance) => root.findAll((node) => (node.type as unknown) === 'Text').map((node) => [node.props.children].flat().join(''))
const asked = (sendRequest: ReturnType<typeof vi.fn>, method: string) => sendRequest.mock.calls.filter((call) => call[0] === method)

const ONE = [LEAD, ...SHEET_RUN]
/** Both Reads in one run (the text between them taken out), so their two
 *  pictures share one place under the run. */
const TWO = [LEAD, ...SHEET_RUN, ...ROWS_RUN]

describe('a picture Claude read with its Read tool', () => {
  it('shows the picture Claude read, not just its name', async () => {
    const { client } = desktop(sharing)
    const chat = await mount({ client, rows: ONE })
    expect(images(chat.root())).toContain(DATA)
    expect(labelled(chat.root(), 'Image on Desktop: sheet.png. Preview unavailable.')).toHaveLength(0)
  })

  it('opens the picture full-screen on tap', async () => {
    const { client } = desktop(sharing)
    const chat = await mount({ client, rows: ONE })
    const tile = chat.root().find((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'imagebutton')
    act(() => tile.props.onPress())
    expect(peekImagePreview()).toMatchObject({ uri: DATA, index: 0 })
  })

  it('does not read a picture until its row is shown', async () => {
    const { client, sendRequest } = desktop(sharing)
    const chat = await mount({ client, rows: ONE, shown: false })
    expect(sendRequest).not.toHaveBeenCalled()
    await chat.show()
    expect(asked(sendRequest, 'files.resolveTerminalPath').map((call) => call[1].pathText)).toEqual([SHEET_PATH])
    expect(images(chat.root())).toContain(DATA)
  })

  it('keeps the chip and says why when the picture cannot be read', async () => {
    const { client } = desktop(refusing)
    const chat = await mount({ client, rows: ONE })
    expect(images(chat.root())).toHaveLength(0)
    const [chip] = labelled(chat.root(), 'Image on Desktop: sheet.png. Preview unavailable.')
    expect(chip).toBeDefined()
    act(() => chip!.props.onPress())
    expect(texts(chat.root()).some((line) => line.includes("The desktop didn't share this picture"))).toBe(true)
    // The one line it leaves behind names the file and the rule that refused it.
    expect(warn.mock.calls.map((call) => String(call[0])).some((line) => line.includes(`no picture for ${SHEET_PATH}`) && line.includes('did not share it'))).toBe(true)
  })

  it.each(['light', 'dark'] as const)('holds the picture\'s place at its tile size while the desktop has not answered (%s)', async (scheme) => {
    const { client } = desktop(silent)
    const chat = await mount({ client, rows: ONE }, scheme)
    const [tile] = loadingTiles(chat.root())
    expect(tile).toBeDefined()
    const style = flat(tile!.props.style)
    const colors = colorsForScheme(scheme)
    expect(style).toMatchObject({ width: 96, height: 96, borderRadius: 12, backgroundColor: colors.chatBg, borderColor: colors.border })
    expect(tile!.props.accessibilityLabel).toBe('Loading image: sheet.png')
    expect(labelled(chat.root(), 'Image on Desktop: sheet.png. Preview unavailable.')).toHaveLength(0)
  })
})

describe('how many pictures a run read', () => {
  it('asks for nothing and draws no picture slot when the run read no picture', async () => {
    const { client, sendRequest } = desktop(sharing)
    const textRead: NativeChatMessage[] = [
      LEAD,
      { id: 'r-ts', role: 'assistant', timestamp: Date.parse('2026-10-14T08:48:45Z'), source: 'transcript', blocks: [{ type: 'tool-call', name: 'Read', input: { file_path: '/repo/mobile/src/session/use-host-image-previews.ts' } }] },
      { id: 'r-ts-result', role: 'tool', timestamp: Date.parse('2026-10-14T08:48:46Z'), source: 'transcript', blocks: [{ type: 'tool-result', output: '1\timport …' }] }
    ]
    const chat = await mount({ client, rows: textRead })
    expect(sendRequest).not.toHaveBeenCalled()
    expect(images(chat.root())).toHaveLength(0)
    expect(loadingTiles(chat.root())).toHaveLength(0)
  })

  it('lays several pictures out in one row while they are still coming, so the row does not jump', async () => {
    const { client } = desktop(silent)
    const chat = await mount({ client, rows: TWO })
    const [row] = chat.root().findAll((node) => node.props.testID === 'chat-agent-image-row')
    expect(row).toBeDefined()
    expect(loadingTiles(row!).map((tile) => tile.props.accessibilityLabel)).toEqual(['Loading image: sheet.png', 'Loading image: rows.png'])
  })

  it('keeps one row of thumbnails once several pictures come, each opening full-screen with the others a swipe away', async () => {
    let n = 0
    const { client } = desktop((method, params) =>
      method === 'files.resolveTerminalPath'
        ? sharing(method, params)
        : { ok: true, result: { isBinary: true, isImage: true, mimeType: 'image/png', content: `${PNG}${(n += 1) === 1 ? 'A' : 'B'}` } }
    )
    const chat = await mount({ client, rows: TWO })
    const tiles = chat.root().findAll((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'imagebutton')
    expect(tiles).toHaveLength(2)
    act(() => tiles[1]!.props.onPress())
    expect(peekImagePreview()).toMatchObject({ index: 1 })
    expect((peekImagePreview() as { uris: string[] }).uris).toHaveLength(2)
  })

  it('draws the picture that came and a chip for the one the desktop refused, in the same place', async () => {
    const { client } = desktop((method, params) => (params.pathText === ROWS_PATH ? refusing(method, params) : sharing(method, params)))
    const chat = await mount({ client, rows: TWO })
    expect(images(chat.root())).toContain(DATA)
    expect(labelled(chat.root(), 'Image on Desktop: rows.png. Preview unavailable.')).not.toHaveLength(0)
    expect(loadingTiles(chat.root())).toHaveLength(0)
  })

  it('draws each picture under its own run when the agent wrote between them', async () => {
    const { client } = desktop(sharing)
    const chat = await mount({ client, rows: [LEAD, ...SHEET_RUN, BETWEEN, ...ROWS_RUN] })
    expect(images(chat.root()).filter((uri) => uri === DATA)).toHaveLength(2)
  })
})

describe('a picture too large for the chat', () => {
  /** A Read of a file inside the worktree: Orca resolves it to the worktree
   *  and the phone can ask its size first. */
  const inRepo = (size: number | 'refused'): Answer => (method, params) => {
    if (method === 'files.resolveTerminalPath') {
      return { ok: true, result: { worktree: 'wt', openTarget: { kind: 'worktree-file', relativePath: 'docs/sheet.png', absolutePath: params.pathText } } }
    }
    if (method === 'files.stat') {
      return size === 'refused'
        ? { ok: false, error: { code: 'forbidden', message: 'files.stat is not available to mobile clients' } }
        : { ok: true, result: { size, isDirectory: false, mtime: 1 } }
    }
    return { ok: true, result: { isBinary: true, isImage: true, mimeType: 'image/png', content: PNG } }
  }

  it('is never read, keeps its chip, and says it is too large', async () => {
    const { client, sendRequest } = desktop(inRepo(40 * 1024 * 1024))
    const chat = await mount({ client, rows: ONE })
    expect(asked(sendRequest, 'files.readPreview')).toHaveLength(0)
    const [chip] = labelled(chat.root(), 'Image on Desktop: sheet.png. Preview unavailable.')
    expect(chip).toBeDefined()
    act(() => chip!.props.onPress())
    expect(texts(chat.root()).some((line) => line.includes('too large'))).toBe(true)
    expect(warn.mock.calls.map((call) => String(call[0])).some((line) => line.includes(`no picture for ${SHEET_PATH}`) && line.includes('40.0 MB') && line.includes('8.0 MB'))).toBe(true)
  })

  it('is read when its size is under the cap', async () => {
    const { client, sendRequest } = desktop(inRepo(774_388))
    const chat = await mount({ client, rows: ONE })
    expect(asked(sendRequest, 'files.readPreview')).toHaveLength(1)
    expect(images(chat.root())).toContain(DATA)
  })

  it('is still read when the desktop will not say its size', async () => {
    const { client, sendRequest } = desktop(inRepo('refused'))
    const chat = await mount({ client, rows: ONE })
    expect(asked(sendRequest, 'files.readPreview')).toHaveLength(1)
    expect(images(chat.root())).toContain(DATA)
  })
})
