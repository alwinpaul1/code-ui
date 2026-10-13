import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'

// The + sheet's 20-attachment limit counts what the user attached: a video
// read into frames is one attachment, not one per frame (Opus review,
// 2026-10-12, after the limit landed counting chips).
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
  FileUp: 'FileUp',
  ScrollText: 'ScrollText',
  ShieldOff: 'ShieldOff',
  Zap: 'Zap',
  Plus: 'Plus',
  Camera: 'Camera',
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

function frames(count: number): PendingNativeChatImage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `f-${i + 1}`,
    path: `/tmp/f-${i + 1}.png`,
    previewUri: `file:///f-${i + 1}.jpg`,
    videoFrame: {
      groupId: 'v1',
      index: i,
      total: count,
      sourceName: 'v1.mp4',
      durationLabel: '1:00',
      intervalLabel: '3 s',
      intervalMs: 3000,
      sourceSizeLabel: '40 MB',
      stoppedEarly: false
    }
  }))
}

describe('the attachment count the + sheet is given', () => {
  it.each(['light', 'dark'] as const)('counts a video read into 20 frames once (%s)', async (scheme) => {
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatComposer
            value=""
            onChangeText={vi.fn()}
            onSend={vi.fn().mockResolvedValue(true)}
            sendSurfaceId="tab-a"
            getSendCompletionGeneration={() => 0}
            getComposerEditGeneration={() => 0}
            onAttachImage={vi.fn()}
            onAttachFile={vi.fn()}
            attachments={frames(20)}
          />
        </ThemeProvider>
      )
    })
    const button = renderer!.root.find((node) => typeof node.props.attachmentCount === 'number')
    expect(button.props.attachmentCount).toBe(1)
  })
})
