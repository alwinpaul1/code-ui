import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer, type ReactTestRendererJSON } from 'react-test-renderer'
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
import { collectHostImagePaths, loadHostImage, resetHostImagePreviewCacheForTests } from './use-host-image-previews'
import { ThemeProvider } from '../theme/theme-context'
import { colorsForScheme } from '../theme/tokens'
import {
  CHIPS_AFTER,
  CHIPS_BEFORE,
  CHIPS_PATH,
  CHIPS_RUN,
  FIRST_CHIPS_READ_ID,
  SECOND_CHIPS_READ_ID
} from './fixtures/claude-agent-read-same-image-twice-2.1.296'
import { READ_IMAGE_CALL_ID, READ_IMAGE_PATH, READ_IMAGE_ROWS } from './fixtures/claude-agent-message-read-image-2.1.283'

// The user's report of 2026-10-13 (Code UI 0.9.131): under "Ran 3 commands,
// read 2 files" two "chips.png" placeholders sat on each other, and neither
// showed the picture. The run is the real one (fixture): the agent read one
// scratchpad screenshot twice.

const RAW = [CHIPS_BEFORE, ...CHIPS_RUN, CHIPS_AFTER]
const LOADED = 'file:///cache/codeui-host-image-chips.png'
const OTHER_LOADED = 'file:///cache/codeui-host-image-img39.jpeg'

function turnOf(raw: NativeChatMessage[], previews: Record<string, string[]>): NativeChatMessage {
  const folded = foldMobileNativeChatMessages(raw)
  const { data } = buildMobileNativeChatTransientData({ messages: raw, folded, streaming: null, pending: [], imagePreviewsByMessageId: previews })
  return data.find((message) => message.id === raw[0]!.id)!
}

const imageRefs = (message: NativeChatMessage) => message.blocks.filter((block) => block.type === 'image-ref')

/** A second picture, a different file read in the same run, after the chips. */
const otherRead: NativeChatMessage[] = READ_IMAGE_ROWS.map((row) => ({ ...row, timestamp: (row.timestamp ?? 0) + Date.parse('2026-10-13T12:30:04Z') - Date.parse('2026-09-26T12:09:59Z') }))

type Style = Record<string, unknown>
const flat = (style: unknown): Style =>
  Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : style && typeof style === 'object' ? (style as Style) : {}

const containsLabel = (node: ReactTestRendererJSON | string, test: (props: Style) => boolean): boolean =>
  typeof node !== 'string' && (test(node.props) || (node.children ?? []).some((child) => containsLabel(child, test)))

/** The space the layout puts between two pictures: the margins of the two
 *  siblings that hold them, plus the gap of the box they share. */
function spaceBetween(tree: ReactTestRendererJSON, first: (props: Style) => boolean, second: (props: Style) => boolean): number | null {
  const children = (tree.children ?? []).filter((child): child is ReactTestRendererJSON => typeof child !== 'string')
  const a = children.findIndex((child) => containsLabel(child, first))
  const b = children.findIndex((child) => containsLabel(child, second))
  if (a === -1 || b === -1) {
    return null
  }
  if (a !== b) {
    const gap = Number(flat(tree.props.style).gap ?? 0)
    return Number(flat(children[a]!.props.style).marginBottom ?? 0) + gap + Number(flat(children[b]!.props.style).marginTop ?? 0)
  }
  return spaceBetween(children[a]!, first, second)
}

const placeholderOf = (name: string) => (props: Style) =>
  typeof props.accessibilityLabel === 'string' && props.accessibilityLabel.startsWith(`Image on Desktop: ${name}.`)
const tileOf = (uri: string) => (props: Style) => (props.source as { uri?: string } | undefined)?.uri === uri

/** The desktop as it answers a scratchpad path no assistant text names
 *  (Orca's resolveTerminalPath outside every workspace): a resolution with no
 *  open target. */
function refusingDesktop(): RpcClient {
  return {
    sendRequest: vi.fn(async () => ({
      ok: true,
      result: { worktree: 'worktree', relativePath: null, absolutePath: null, exists: false, isDirectory: false }
    }))
  } as unknown as RpcClient
}

describe('the same picture read twice in one run', () => {
  it('is asked of the host by the path both Reads named, and no other', () => {
    expect(collectHostImagePaths(RAW, undefined)).toEqual({ [FIRST_CHIPS_READ_ID]: [CHIPS_PATH], [SECOND_CHIPS_READ_ID]: [CHIPS_PATH] })
  })

  it('draws one placeholder, not two, while the host has not sent it', () => {
    const turn = turnOf(RAW, { [FIRST_CHIPS_READ_ID]: [''], [SECOND_CHIPS_READ_ID]: [''] })
    expect(imageRefs(turn)).toEqual([{ type: 'image-ref', path: CHIPS_PATH, alt: 'Image the agent read' }])
  })

  it('draws one picture, not two, once the host sends it', () => {
    const turn = turnOf(RAW, { [FIRST_CHIPS_READ_ID]: [LOADED], [SECOND_CHIPS_READ_ID]: [LOADED] })
    expect(imageRefs(turn)).toEqual([{ type: 'image-ref', path: CHIPS_PATH, url: LOADED, alt: 'Image the agent read' }])
  })

  it('keeps each other picture of the run in its own slot', () => {
    const turn = turnOf([...RAW.slice(0, -1), ...otherRead, CHIPS_AFTER], {
      [FIRST_CHIPS_READ_ID]: [''],
      [SECOND_CHIPS_READ_ID]: [''],
      [READ_IMAGE_CALL_ID]: [OTHER_LOADED]
    })
    expect(imageRefs(turn).map((block) => [block.path, block.url])).toEqual([
      [CHIPS_PATH, undefined],
      [READ_IMAGE_PATH, OTHER_LOADED]
    ])
  })
})

describe('pictures that follow each other in a turn', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  const render = (message: NativeChatMessage, scheme: 'light' | 'dark' = 'light'): ReactTestRendererJSON => {
    act(() => {
      renderer = create((
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatMessage message={message} />
        </ThemeProvider>
      ))
    })
    return renderer!.toJSON() as ReactTestRendererJSON
  }
  const twoReads = [...RAW.slice(0, -1), ...otherRead, CHIPS_AFTER]

  it.each(['light', 'dark'] as const)('keep 8 dp between two placeholders, never touching (%s)', (scheme) => {
    const turn = turnOf(twoReads, { [FIRST_CHIPS_READ_ID]: [''], [SECOND_CHIPS_READ_ID]: [''], [READ_IMAGE_CALL_ID]: [''] })
    const tree = render(turn, scheme)
    expect(spaceBetween(tree, placeholderOf('chips.png'), placeholderOf('img39_1.jpeg'))).toBe(8)
  })

  it.each(['light', 'dark'] as const)('keep 8 dp between a loaded tile and the placeholder after it (%s)', (scheme) => {
    const turn = turnOf(twoReads, { [FIRST_CHIPS_READ_ID]: [LOADED], [SECOND_CHIPS_READ_ID]: [LOADED], [READ_IMAGE_CALL_ID]: [''] })
    const tree = render(turn, scheme)
    expect(spaceBetween(tree, tileOf(LOADED), placeholderOf('img39_1.jpeg'))).toBe(8)
  })

  it('keep 8 dp between a placeholder and the loaded tile after it', () => {
    const turn = turnOf(twoReads, { [FIRST_CHIPS_READ_ID]: [''], [SECOND_CHIPS_READ_ID]: [''], [READ_IMAGE_CALL_ID]: [OTHER_LOADED] })
    const tree = render(turn)
    expect(spaceBetween(tree, placeholderOf('chips.png'), tileOf(OTHER_LOADED))).toBe(8)
  })

  // The degenerate size: one picture has no neighbour to keep away from.
  it('add no space above a lone picture', () => {
    const turn = turnOf(RAW, { [FIRST_CHIPS_READ_ID]: [''], [SECOND_CHIPS_READ_ID]: [''] })
    const tree = render(turn)
    const holders: Style[] = []
    const walk = (node: ReactTestRendererJSON | string) => {
      if (typeof node === 'string') {
        return
      }
      for (const child of node.children ?? []) {
        if (typeof child !== 'string' && containsLabel(child, placeholderOf('chips.png'))) {
          holders.push(flat(child.props.style))
        }
        walk(child)
      }
    }
    walk(tree)
    expect(holders.every((style) => !style.marginTop)).toBe(true)
  })
})

describe('a placeholder for a picture the desktop did not share', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    resetHostImagePreviewCacheForTests()
    vi.restoreAllMocks()
  })
  const render = (message: NativeChatMessage, scheme: 'light' | 'dark'): ReactTestInstance => {
    act(() => {
      renderer = create((
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatMessage message={message} />
        </ThemeProvider>
      ))
    })
    return renderer!.root
  }
  const placeholder = (root: ReactTestInstance) =>
    root.find((node) => (node.type as unknown) === 'Pressable' && placeholderOf('chips.png')(node.props))
  const texts = (root: ReactTestInstance) =>
    root.findAll((node) => (node.type as unknown) === 'Text').map((node) => ({ text: [node.props.children].flat().join(''), style: flat(node.props.style) }))

  it.each(['light', 'dark'] as const)('says so when tapped, in the theme’s muted text (%s)', async (scheme) => {
    const uri = await loadHostImage({
      client: refusingDesktop(),
      hostId: 'host',
      worktreeId: 'worktree',
      nativeChatContext: { tabId: 'tab', sessionId: '3dec2e94-c429-4c34-af89-68c601b2d4ec' },
      terminalHandle: 'term',
      path: CHIPS_PATH,
      agentTextNamesPath: false
    })
    expect(uri).toBeNull()
    const root = render(turnOf(RAW, { [FIRST_CHIPS_READ_ID]: [''], [SECOND_CHIPS_READ_ID]: [''] }), scheme)
    const chip = placeholder(root)
    expect(chip.props.accessibilityRole).toBe('button')
    expect(texts(root).some((line) => line.text.includes("didn't share"))).toBe(false)
    act(() => chip.props.onPress())
    const note = texts(root).find((line) => line.text.includes("The desktop didn't share this picture"))
    expect(note).toBeDefined()
    expect(note!.style.color).toBe(colorsForScheme(scheme).textSecondary)
    act(() => chip.props.onPress())
    expect(texts(root).some((line) => line.text.includes("didn't share"))).toBe(false)
  })

  // The failure path: the ask itself failed (the relay, not the desktop's
  // rule), so the placeholder must not blame the desktop's sharing.
  it('says it could not be fetched, not refused, when the ask itself failed', async () => {
    const client = { sendRequest: vi.fn(async () => ({ ok: false, error: { code: 'timeout', message: 'request timed out' } })) } as unknown as RpcClient
    const uri = await loadHostImage({
      client,
      hostId: 'host',
      worktreeId: 'worktree',
      nativeChatContext: null,
      terminalHandle: null,
      path: CHIPS_PATH
    })
    expect(uri).toBeNull()
    const root = render(turnOf(RAW, { [FIRST_CHIPS_READ_ID]: [''], [SECOND_CHIPS_READ_ID]: [''] }), 'light')
    act(() => placeholder(root).props.onPress())
    const lines = texts(root).map((line) => line.text)
    expect(lines.some((line) => line.includes("didn't share"))).toBe(false)
    expect(lines.some((line) => line.includes("couldn't be fetched"))).toBe(true)
  })

  // An open note is not a snapshot: the refusal can land while it is open,
  // and nothing else re-renders the turn then (its preview stays '').
  it('changes an open "waiting" note to the refusal when the desktop answers', async () => {
    const root = render(turnOf(RAW, { [FIRST_CHIPS_READ_ID]: [''], [SECOND_CHIPS_READ_ID]: [''] }), 'light')
    act(() => placeholder(root).props.onPress())
    expect(texts(root).some((line) => line.text.includes('Waiting for the desktop'))).toBe(true)
    await act(async () => {
      await loadHostImage({
        client: refusingDesktop(),
        hostId: 'host',
        worktreeId: 'worktree',
        nativeChatContext: { tabId: 'tab', sessionId: '3dec2e94-c429-4c34-af89-68c601b2d4ec' },
        terminalHandle: 'term',
        path: CHIPS_PATH,
        agentTextNamesPath: false
      })
    })
    const lines = texts(root).map((line) => line.text)
    expect(lines.some((line) => line.includes('Waiting for the desktop'))).toBe(false)
    expect(lines.some((line) => line.includes("The desktop didn't share this picture"))).toBe(true)
  })

  it('says it is still waiting, not refused, while the host has not answered', () => {
    const root = render(turnOf(RAW, { [FIRST_CHIPS_READ_ID]: [''], [SECOND_CHIPS_READ_ID]: [''] }), 'light')
    act(() => placeholder(root).props.onPress())
    const lines = texts(root).map((line) => line.text)
    expect(lines.some((line) => line.includes("didn't share"))).toBe(false)
    expect(lines.some((line) => line.includes('Waiting for the desktop'))).toBe(true)
  })
})
