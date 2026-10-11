import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

let scheme: 'light' | 'dark' = 'light'
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
    useColorScheme: () => scheme,
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
import { collectHostImagePaths } from './use-host-image-previews'
import { peekImagePreview, resetImagePreviewForTests } from './image-preview-store'
import { colorsForScheme } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import {
  READ_CALL_ID,
  REPLY_TEXT,
  SEND_CALL_ID,
  SEND_FILE_CAPTION,
  SEND_FILE_PATH,
  SEND_FILE_TURN
} from './fixtures/claude-send-user-file-2.1.296'

// The user's side-by-side screenshots of 2026-10-11, same turn, same session.
// The Claude app: "Ran 2 commands, read a file", the picture the Read
// returned, the SendUserFile caption as a line of text, the sent picture, then
// the reply. Code UI: "Ran 2 commands, read where.png, used a tool", then the
// reply, and no picture at all.

const READ_URI = 'file:///cache/codeui-host-image-read.png'
const SENT_URI = 'file:///cache/codeui-host-image-sent.png'

function drawn(raw: NativeChatMessage[], previews: Record<string, string[]>): NativeChatMessage[] {
  const folded = foldMobileNativeChatMessages(raw)
  return buildMobileNativeChatTransientData({ messages: raw, folded, streaming: null, pending: [], imagePreviewsByMessageId: previews }).data
}

/** The row the turn's work folded into: the first assistant row. */
function stepOf(raw: NativeChatMessage[], previews: Record<string, string[]>): NativeChatMessage {
  return drawn(raw, previews).find((message) => message.id === '790c0712-a09f-4359-9754-562f9f77ac86')!
}

/** What the hook holds while both pictures were asked of the host and none
 *  has come back (pending or refused). */
const ASKED = { [READ_CALL_ID]: [''], [SEND_CALL_ID]: [''] }

function withSend(input: unknown): NativeChatMessage[] {
  return SEND_FILE_TURN.map((message) =>
    message.id === SEND_CALL_ID
      ? { ...message, blocks: [{ type: 'tool-call', name: 'SendUserFile', input, callId: 'toolu_01Xfy5TufAwWWHuBb27AWLKo' }] }
      : message
  )
}

describe('a file the agent sent with SendUserFile', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    scheme = 'light'
    resetImagePreviewForTests()
  })
  const render = (message: NativeChatMessage): ReactTestInstance => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatMessage message={message} />
        </ThemeProvider>
      )
    })
    return renderer!.root
  }
  const json = () => JSON.stringify(renderer!.toJSON())
  const imageButtons = (root: ReactTestInstance) =>
    root.findAll((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'imagebutton')

  it('asks the host for the picture SendUserFile delivered, as it does for the one the Read named', () => {
    expect(collectHostImagePaths(SEND_FILE_TURN, undefined)).toEqual({
      [READ_CALL_ID]: [SEND_FILE_PATH],
      [SEND_CALL_ID]: [SEND_FILE_PATH]
    })
  })

  it('draws the read picture under the tool group, then the caption, then the sent picture, and the group no longer says "used a tool"', () => {
    const step = stepOf(SEND_FILE_TURN, { [READ_CALL_ID]: [READ_URI], [SEND_CALL_ID]: [SENT_URI] })
    expect(step.blocks.map((block) => block.type)).toEqual([
      'tool-call', 'tool-result', 'tool-call', 'tool-result', 'tool-call', 'tool-result', 'image-ref', 'text', 'image-ref'
    ])
    render(step)
    const order = json()
    expect(order).toContain('Ran 2 commands, read where.png')
    expect(order).not.toContain('used a tool')
    const summary = order.indexOf('Ran 2 commands, read where.png')
    expect(summary).toBeLessThan(order.indexOf(READ_URI))
    expect(order.indexOf(READ_URI)).toBeLessThan(order.indexOf(SEND_FILE_CAPTION))
    expect(order.indexOf(SEND_FILE_CAPTION)).toBeLessThan(order.indexOf(SENT_URI))
    // The reply is its own row after the step, as before.
    const rows = drawn(SEND_FILE_TURN, {}).map((message) => message.id)
    expect(rows.indexOf('6197b2c5-cc14-42c7-809e-adcbc21d0af6')).toBe(rows.indexOf(step.id) + 1)
    expect(REPLY_TEXT.length).toBeGreaterThan(0)
  })

  it('draws each picture as a 250 dp rounded square, cropped to fill, and a tap opens it full-screen', () => {
    const root = render(stepOf(SEND_FILE_TURN, { [READ_CALL_ID]: [READ_URI], [SEND_CALL_ID]: [SENT_URI] }))
    const tiles = imageButtons(root)
    expect(tiles).toHaveLength(2)
    const sent = tiles[1]!.findByType('Image' as never)
    expect(sent.props.resizeMode).toBe('cover')
    const style = Object.assign({}, ...[sent.props.style].flat(3).filter(Boolean)) as Record<string, unknown>
    expect(style).toMatchObject({ width: 250, height: 250, borderRadius: 16 })
    act(() => tiles[1]!.props.onPress())
    expect(peekImagePreview()).toMatchObject({ uri: SENT_URI })
  })

  it('shows a placeholder naming the file, and nothing to tap, while the host has not shared the picture', () => {
    const step = stepOf(SEND_FILE_TURN, ASKED)
    const root = render(step)
    expect(imageButtons(root)).toHaveLength(0)
    const placeholders = root.findAll(
      (node) => typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith('Image on Desktop: where.png')
    )
    // One for the Read's picture, one for the sent one; the caption still shows.
    expect(placeholders.filter((node) => (node.type as unknown) === 'View')).toHaveLength(2)
    expect(json()).toContain(SEND_FILE_CAPTION)
    expect(json()).not.toContain('used a tool')
  })

  it('draws the placeholder in the dark theme with the dark surface, not the light one', () => {
    scheme = 'dark'
    const root = render(stepOf(SEND_FILE_TURN, ASKED))
    const [chip] = root.findAll(
      (node) => (node.type as unknown) === 'View' && String(node.props.accessibilityLabel ?? '').startsWith('Image on Desktop: where.png')
    )
    const style = Object.assign({}, ...[chip!.props.style].flat(3).filter(Boolean)) as Record<string, unknown>
    // bgPanel since 2026-10-11: bgRaised became the sent prompt's card colour.
    expect(style.backgroundColor).toBe(colorsForScheme('dark').bgPanel)
    expect(style.backgroundColor).not.toBe(colorsForScheme('light').bgPanel)
  })

  it('sends nothing to draw for an empty file list: the caption alone, no picture, no crash', () => {
    const step = stepOf(withSend({ files: [], caption: SEND_FILE_CAPTION, status: 'normal', display: 'render' }), { [READ_CALL_ID]: [''] })
    expect(step.blocks.filter((block) => block.type === 'image-ref')).toHaveLength(1) // the Read's
    render(step)
    expect(json()).toContain(SEND_FILE_CAPTION)
    expect(json()).not.toContain('used a tool')
  })

  it('leaves a SendUserFile it cannot read as the tool row it was, rather than guess', () => {
    for (const input of [null, 'where.png', { files: 'where.png' }, { files: [42] }]) {
      const step = stepOf(withSend(input), {})
      expect(step.blocks.filter((block) => block.type === 'tool-call').map((block) => (block as { name: string }).name)).toContain('SendUserFile')
      render(step)
      expect(json()).toContain('used a tool')
      act(() => renderer?.unmount())
      renderer = null
    }
  })

  // The Opus review of 61da3b3d5: a send that failed drew as a caption and a
  // picture slot, so the user read a failure as a delivery. The recorded
  // failures (2.1.239, 2.1.286) are input errors and keep their tool row
  // anyway; this one passes input validation and fails at the file, wording
  // modelled on those `<tool_use_error>` envelopes.
  it('keeps a send that failed as the tool row with its error, with no caption and no picture', () => {
    const failed = SEND_FILE_TURN.map((message) =>
      message.id === '518dd6ab-af77-4194-8648-af6caabfce35'
        ? { ...message, blocks: [{ type: 'tool-result' as const, output: `<tool_use_error>File does not exist: ${SEND_FILE_PATH}</tool_use_error>`, isError: true }] }
        : message
    )
    const step = stepOf(failed, { [READ_CALL_ID]: [READ_URI], [SEND_CALL_ID]: [''] })
    expect(step.blocks.map((block) => (block.type === 'tool-call' ? block.name : block.type))).toEqual([
      'Bash', 'tool-result', 'Bash', 'tool-result', 'Read', 'tool-result', 'SendUserFile', 'tool-result', 'image-ref'
    ])
    render(step)
    expect(json()).not.toContain(SEND_FILE_CAPTION)
  })

  it('names no file for a Read that failed', () => {
    const failed = SEND_FILE_TURN.map((message) =>
      message.id === 'c8849b9b-271e-4c06-af4a-dc80ed991a52'
        ? { ...message, blocks: [{ type: 'tool-result' as const, output: `<tool_use_error>File does not exist.</tool_use_error>`, isError: true }] }
        : message
    )
    // The hook still asked for it (its records are one block each) and holds
    // an empty entry; the sent picture after it keeps its own.
    const step = stepOf(failed, { [READ_CALL_ID]: [''], [SEND_CALL_ID]: [SENT_URI] })
    expect(step.blocks.filter((block) => block.type === 'image-ref')).toEqual([
      { type: 'image-ref', path: SEND_FILE_PATH, url: SENT_URI, alt: 'Image the agent sent' }
    ])
  })

  it('draws a sent PDF as a file card, by its name and extension, not as a picture', () => {
    const pdf = '/Users/alwinpaul/Desktop/Project/Code UI/docs/out/report.pdf'
    const raw = withSend({ files: [pdf], caption: 'The report', status: 'normal', display: 'render' })
    expect(collectHostImagePaths(raw, undefined)[SEND_CALL_ID]).toBeUndefined()
    const root = render(stepOf(raw, {}))
    const card = root.find((node) => node.props.accessibilityLabel === 'Sent file report')
    expect(JSON.stringify(renderer!.toJSON())).toContain('PDF')
    expect(card).toBeTruthy()
  })
})
