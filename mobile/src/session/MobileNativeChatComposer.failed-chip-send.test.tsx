import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'

// The Claude app's send button (yv8.i, com.anthropic.claude 1.261009.20) is
// Ready beside a chip still uploading, and Idle (off) while any chip's upload
// failed or was too large (j29.e): a submit then does nothing, so the photo
// is never dropped and the message never half-sent. Code UI let Send be
// tapped there and refused afterwards with a line.
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Keyboard: { dismiss: vi.fn(), isVisible: () => false, addListener: () => ({ remove: () => {} }) },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))
vi.mock('react-native-svg', () => ({ default: () => null, Circle: () => null }))
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Code: 'Code',
  Hand: 'Hand',
  Image: 'Image',
  ImagePlus: 'ImagePlus',
  Mic: 'Mic',
  Paperclip: 'Paperclip',
  ScrollText: 'ScrollText',
  ShieldOff: 'ShieldOff',
  Zap: 'Zap',
  Plus: 'Plus',
  RotateCcw: 'RotateCcw',
  FileText: 'FileText',
  Film: 'Film',
  Square: 'Square',
  X: 'X'
}))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: () => null }))

import { MobileNativeChatComposer } from './MobileNativeChatComposer'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

const READY: PendingNativeChatImage = { id: 'img-1', path: '/tmp/a.png', previewUri: 'file:///a.jpg' }
const UPLOADING: PendingNativeChatImage = { id: 'img-2', path: '', previewUri: 'file:///b.jpg', uploading: true }
const FAILED: PendingNativeChatImage = { id: 'img-3', path: '', previewUri: 'file:///c.jpg', failed: true }

async function render(
  value: string,
  attachments: PendingNativeChatImage[],
  scheme: 'light' | 'dark',
  onSend = vi.fn().mockResolvedValue(true)
): Promise<void> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatComposer
          value={value}
          onChangeText={vi.fn()}
          onSend={onSend}
          sendSurfaceId="tab-a"
          getSendCompletionGeneration={() => 0}
          getComposerEditGeneration={() => 0}
          onAttachImage={vi.fn()}
          attachments={attachments}
        />
      </ThemeProvider>
    )
  })
}

function sendButton(): ReactTestInstance {
  return renderer!.root.find(
    (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === 'Send message'
  )
}

describe('Send beside a chip whose upload failed', () => {
  it.each(['light', 'dark'] as const)('is off while a chip has failed, with words or without (%s)', async (scheme) => {
    const onSend = vi.fn().mockResolvedValue(true)
    await render('look at these', [READY, FAILED], scheme, onSend)
    expect(sendButton().props.disabled).toBe(true)
    expect(sendButton().props.accessibilityState).toEqual({ disabled: true })
    await act(async () => {
      sendButton().props.onPress()
    })
    expect(onSend).not.toHaveBeenCalled()
  })

  it.each(['light', 'dark'] as const)('is off for a lone failed chip (%s)', async (scheme) => {
    await render('', [FAILED], scheme)
    expect(sendButton().props.disabled).toBe(true)
  })

  it.each(['light', 'dark'] as const)('stays on beside a chip still uploading, so the tap can wait for it (%s)', async (scheme) => {
    await render('look', [READY, UPLOADING], scheme)
    expect(sendButton().props.disabled).toBe(false)
  })
})
