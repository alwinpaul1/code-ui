import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNativeChatAttachSheet } from './MobileNativeChatAttachSheet'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 }
}))
const drawer = vi.hoisted(() => ({ onAfterClose: undefined as (() => void) | undefined }))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ children, onAfterClose }: { children: unknown; onAfterClose?: () => void }) => {
    drawer.onAfterClose = onAfterClose
    return children
  }
}))
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))
vi.mock('lucide-react-native', () => ({
  Camera: 'Camera',
  Image: 'Image',
  Paperclip: 'Paperclip',
  FileUp: 'FileUp',
  Zap: 'Zap',
  // The Permission row's glyph per mode (permission-mode-appearance.ts).
  Code: 'Code',
  Hand: 'Hand',
  ScrollText: 'ScrollText',
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

  // The user's screenshot of the Claude app's sheet, 2026-10-13: a camera
  // outline, a picture (mountain and sun in a rounded square), and a document
  // with an up arrow in it. Code UI's own size, stroke and colour stay.
  it("draws the Claude app's icons on the tiles: a camera, a picture, a file with an up arrow", () => {
    const root = render({
      visible: true,
      onClose: vi.fn(),
      onCaptureImage: vi.fn(),
      onAttachImage: vi.fn(),
      onAttachFile: vi.fn()
    })
    const iconOf = (label: string) => {
      const tile = root
        .findAllByType('Pressable')
        .find((node) => node.props.accessibilityLabel === label)!
      const icon = tile.findAll((node) => ['Camera', 'Image', 'FileUp', 'Paperclip'].includes(String(node.type)))
      expect(icon).toHaveLength(1)
      return { name: String(icon[0]!.type), props: icon[0]!.props }
    }
    expect(['Camera', 'Photos', 'Files'].map((label) => iconOf(label).name)).toEqual([
      'Camera',
      'Image',
      'FileUp'
    ])
    expect(iconOf('Files').props).toMatchObject({ size: 24, color: '#fff', strokeWidth: 1.8 })
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

  it('closes when a card is tapped, and runs its source once the sheet has gone', () => {
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
    // The camera is an Activity: launched over the closing sheet, it froze the
    // sheet's exit (plus-sheet-closes-before-the-picker-opens.test.tsx).
    expect(onCaptureImage).not.toHaveBeenCalled()
    act(() => drawer.onAfterClose?.())
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

  // The Claude app's + sheet (`hta.a`, 1.261009.20): once a message holds 20
  // attachments every source tile is off and one line under them says why.
  const LIMIT_LINE = 'You can add at most 20 attachments to a message.'

  function texts(root: ReturnType<typeof render>): string[] {
    return root.findAllByType('Txt').map((node) => String(node.props.children))
  }

  it('turns every source off and says the limit once the message holds 20 attachments', () => {
    const onCaptureImage = vi.fn()
    const root = render({
      visible: true,
      onClose: vi.fn(),
      onCaptureImage,
      onAttachImage: vi.fn(),
      onAttachFile: vi.fn(),
      attachmentCount: 20
    })
    const cards = root
      .findAllByType('Pressable')
      .filter((node) => ['Camera', 'Photos', 'Files'].includes(node.props.accessibilityLabel))
    expect(cards).toHaveLength(3)
    expect(cards.every((card) => card.props.disabled === true)).toBe(true)
    expect(texts(root)).toContain(LIMIT_LINE)
  })

  it('keeps every source on, with no limit line, at 19 attachments', () => {
    const root = render({
      visible: true,
      onClose: vi.fn(),
      onCaptureImage: vi.fn(),
      onAttachImage: vi.fn(),
      onAttachFile: vi.fn(),
      attachmentCount: 19
    })
    const cards = root
      .findAllByType('Pressable')
      .filter((node) => ['Camera', 'Photos', 'Files'].includes(node.props.accessibilityLabel))
    expect(cards.every((card) => card.props.disabled === false)).toBe(true)
    expect(texts(root)).not.toContain(LIMIT_LINE)
  })
})
