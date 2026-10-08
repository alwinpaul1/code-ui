import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

vi.mock('../components/DraggableDetailSheet', () => ({ DraggableDetailSheet: () => null }))
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): unknown => React.createElement('Text', props, children)
  return {
    Platform: { OS: 'android' },
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
import { collectHostImagePaths } from './use-host-image-previews'
import { peekImagePreview, resetImagePreviewForTests } from './image-preview-store'
import {
  READ_IMAGE_CALL_ID,
  READ_IMAGE_PATH,
  READ_IMAGE_ROWS
} from './fixtures/claude-agent-message-read-image-2.1.283'

// Claude Code 2.1.283 reading a screenshot with its Read tool. The Claude app
// shows the picture under "Ran 3 commands, read 2 files" and opens it on a tap
// (the user's screenshot, 2026-09-26). Orca 1.4.212 hands the phone the call
// and an EMPTY result: the image block never arrives. The phone asks the host
// for the file the call named, and draws what comes back in the step.

const at = (clock: string) => Date.parse(`2026-09-26T${clock}Z`)
const said = (id: string, text: string, clock: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  timestamp: at(clock),
  source: 'transcript',
  blocks: [{ type: 'text', text }]
})
const bash: NativeChatMessage[] = [
  { id: 'b1', role: 'assistant', timestamp: at('12:09:50.000'), source: 'transcript', blocks: [{ type: 'tool-call', name: 'Bash', input: { command: 'adb exec-out screencap -p > shot.png' } }] },
  { id: 'b2', role: 'tool', timestamp: at('12:09:51.000'), source: 'transcript', blocks: [{ type: 'tool-result', output: '' }] }
]
const SECOND_PATH = '/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/790eafa8-07b2-4380-abc2-90e22f965369/scratchpad/imgs/img39_2.jpeg'
const secondRead: NativeChatMessage[] = [
  { id: 'r2', role: 'assistant', timestamp: at('12:10:00.000'), source: 'transcript', blocks: [{ type: 'tool-call', name: 'Read', input: { file_path: SECOND_PATH } }] },
  { id: 'r2-result', role: 'tool', timestamp: at('12:10:00.100'), source: 'transcript', blocks: [{ type: 'tool-result', output: '' }] }
]
const BEFORE = said('t1', 'Selection works in the file tab, so the fault is specific to the chat list.', '12:09:40.000')
const AFTER = said('t2', 'The phone code view uses a proportional font.', '12:10:05.000')
const FIRST_URI = 'file:///cache/codeui-host-image-1.jpeg'
const SECOND_URI = 'file:///cache/codeui-host-image-2.jpeg'

function stepOf(raw: NativeChatMessage[], previews: Record<string, string[]>): NativeChatMessage {
  const folded = foldMobileNativeChatMessages(raw)
  const { data } = buildMobileNativeChatTransientData({ messages: raw, folded, streaming: null, pending: [], imagePreviewsByMessageId: previews })
  return data.find((message) => message.id === 't1')!
}

describe('an image the agent read', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    resetImagePreviewForTests()
  })
  const render = (message: NativeChatMessage): ReactTestInstance => {
    act(() => {
      renderer = create(createElement(MobileNativeChatMessage, { message }))
    })
    return renderer!.root
  }
  const imageButtons = (root: ReactTestInstance) =>
    root.findAll((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'imagebutton')

  it('is asked of the host by the path the Read named, though the result the phone gets is empty', () => {
    expect(READ_IMAGE_ROWS[1]?.blocks).toEqual([{ type: 'tool-result', output: '' }])
    expect(collectHostImagePaths([BEFORE, ...READ_IMAGE_ROWS, AFTER], undefined)).toEqual({ [READ_IMAGE_CALL_ID]: [READ_IMAGE_PATH] })
  })

  // The phone's sentence names a lone read file (0ddee6f8).
  it('is drawn in its step, under "Ran a command, read img39_1.jpeg", and a tap opens it full-screen', () => {
    const step = stepOf([BEFORE, ...bash, ...READ_IMAGE_ROWS, AFTER], { [READ_IMAGE_CALL_ID]: [FIRST_URI] })
    expect(step.blocks.map((block) => block.type)).toEqual(['text', 'tool-call', 'tool-result', 'tool-call', 'tool-result', 'image-ref'])
    const root = render(step)
    const order = JSON.stringify(renderer!.toJSON())
    expect(order.indexOf('Ran a command, read img39_1.jpeg')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('Ran a command, read img39_1.jpeg')).toBeLessThan(order.indexOf(FIRST_URI))

    const [thumb] = imageButtons(root)
    act(() => thumb!.props.onPress())
    expect(peekImagePreview()).toMatchObject({ uri: FIRST_URI, uris: [FIRST_URI], index: 0 })
  })

  it("opens the tapped one of a step's two images, with the other a swipe away", () => {
    const step = stepOf([BEFORE, ...READ_IMAGE_ROWS, ...secondRead, AFTER], { [READ_IMAGE_CALL_ID]: [FIRST_URI], r2: [SECOND_URI] })
    const root = render(step)
    const tiles = imageButtons(root)
    expect(tiles.map((tile) => tile.props.accessibilityLabel)).toEqual(['Image the agent read 1 of 2', 'Image the agent read 2 of 2'])
    act(() => tiles[1]!.props.onPress())
    expect(peekImagePreview()).toMatchObject({ uri: SECOND_URI, uris: [FIRST_URI, SECOND_URI], index: 1 })
  })

  it('leaves the step as it was while the host has not sent the picture', () => {
    const step = stepOf([BEFORE, ...READ_IMAGE_ROWS, AFTER], {})
    expect(step.blocks.some((block) => block.type === 'image-ref')).toBe(false)
    expect(imageButtons(render(step))).toHaveLength(0)
  })
})
