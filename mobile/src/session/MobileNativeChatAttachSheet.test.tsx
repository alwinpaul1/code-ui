import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNativeChatAttachSheet } from './MobileNativeChatAttachSheet'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ children }: { children: unknown }) => children
}))
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))
vi.mock('lucide-react-native', () => ({
  Camera: 'Camera',
  Image: 'Image',
  Paperclip: 'Paperclip',
  Zap: 'Zap',
  ChevronRight: 'ChevronRight'
}))
vi.mock('../theme/theme-context', () => ({
  useTheme: () => ({
    colors: {
      text: '#fff',
      textMuted: '#888',
      border: '#333',
      bgPanel: '#111',
      bgRaised: '#222'
    },
    radius: { lg: 12 },
    space: { sm: 8, md: 12 }
  })
}))
vi.mock('./mobile-terminal-hud-parse', () => ({
  permissionModeLabel: (mode: string) => `mode:${mode}`
}))

describe('the Claude-style Add context sheet', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(props: Parameters<typeof MobileNativeChatAttachSheet>[0]) {
    act(() => {
      renderer = create(createElement(MobileNativeChatAttachSheet, props))
    })
    return renderer!.root
  }

  it('offers exactly Camera, Photos and Files, with no paste option', () => {
    const root = render({
      visible: true,
      onClose: vi.fn(),
      onCaptureImage: vi.fn(),
      onAttachImage: vi.fn(),
      onAttachFile: vi.fn()
    })
    const labels = root
      .findAllByType('Pressable')
      .map((node) => node.props.accessibilityLabel)
      .filter(Boolean)
    expect(labels).toEqual(['Camera', 'Photos', 'Files'])
    // The old vertical list carried a "Paste image" row; it is gone.
    expect(labels.some((label: string) => /paste/i.test(label))).toBe(false)
  })

  it('carries no description text under the source cards', () => {
    // The Claude app shows the source name alone; the old sheet printed a hint
    // under each ("Pick from your photo library").
    const root = render({
      visible: true,
      onClose: vi.fn(),
      onCaptureImage: vi.fn(),
      onAttachImage: vi.fn(),
      onAttachFile: vi.fn()
    })
    const texts = root.findAllByType('Txt').map((node) => String(node.props.children))
    expect(texts.some((text) => /pick from your photo library|anything on this phone/i.test(text))).toBe(
      false
    )
  })

  it('runs the source action and closes when a card is tapped', () => {
    const onClose = vi.fn()
    const onCaptureImage = vi.fn()
    const root = render({
      visible: true,
      onClose,
      onCaptureImage,
      onAttachImage: vi.fn(),
      onAttachFile: vi.fn()
    })
    const camera = root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Camera')
    act(() => camera!.props.onPress())
    expect(onClose).toHaveBeenCalledOnce()
    expect(onCaptureImage).toHaveBeenCalledOnce()
  })

  it('shows the permission row only when a handler is given', () => {
    const withRow = render({
      visible: true,
      onClose: vi.fn(),
      onAttachImage: vi.fn(),
      onAttachFile: vi.fn(),
      permissionMode: 'plan',
      onOpenPermission: vi.fn()
    })
    expect(
      withRow
        .findAllByType('Pressable')
        .some((node) => node.props.accessibilityLabel === 'Permission mode')
    ).toBe(true)
    act(() => renderer!.unmount())

    const withoutRow = render({
      visible: true,
      onClose: vi.fn(),
      onAttachImage: vi.fn(),
      onAttachFile: vi.fn()
    })
    expect(
      withoutRow
        .findAllByType('Pressable')
        .some((node) => node.props.accessibilityLabel === 'Permission mode')
    ).toBe(false)
  })
})
