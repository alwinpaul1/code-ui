/**
 * Review of the restyled chips (MobileNativeChatAttachmentChips.tsx), 2026-10-15:
 *  - TalkBack read a document chip as its file name only: "Uploading" / "Upload failed" and the
 *    Retry button sat inside the one `accessible` View, so neither was announced or reachable.
 *  - The remove disc's usable target was about 32 dp: its hitSlop reached past the chip, whose
 *    `overflow: 'hidden'` (and Android's touch rule) dropped the part outside it.
 *  - A long extension (".webmanifest") ran its badge under the remove disc.
 */
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { MobileNativeChatAttachmentChips } from './MobileNativeChatAttachmentChips'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    Image: (props: Record<string, unknown>) => React.createElement('Image', props),
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Text: 'Text',
    View: 'View',
    StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 0.5 },
    useColorScheme: () => 'light'
  }
})
vi.mock('lucide-react-native', () => ({ Film: 'Film', RotateCcw: 'RotateCcw', X: 'X' }))
vi.mock('./mobile-native-chat-upload-retry', () => ({ retryNativeChatUpload: vi.fn(async () => true) }))

type Scheme = 'light' | 'dark'
const SCHEMES: Scheme[] = ['light', 'dark']
const PALETTE = { light: lightColors, dark: darkColors }
const DOC: PendingNativeChatImage = { id: 'doc-1', path: '', previewUri: 'file:///r.pdf', kind: 'file', name: 'report.pdf' }
const PHOTO: PendingNativeChatImage = { id: 'img-1', path: '', previewUri: 'file:///a.jpg' }

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function draw(scheme: Scheme, attachments: PendingNativeChatImage[], onRemoveAttachment = vi.fn()): ReactTestRenderer {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatAttachmentChips attachments={attachments} onRemoveAttachment={onRemoveAttachment} />
      </ThemeProvider>
    )
  })
  return renderer!
}

function pressable(screen: ReactTestRenderer, label: string): ReactTestInstance {
  return screen.root.find((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label)
}

/** The element TalkBack focuses for the chip: the one carrying the reorder actions. */
function chipFocus(screen: ReactTestRenderer): ReactTestInstance {
  return screen.root.find((node) => Array.isArray(node.props.accessibilityActions) && node.props.accessibilityLabel !== undefined)
}

function ancestors(node: ReactTestInstance): ReactTestInstance[] {
  const out: ReactTestInstance[] = []
  for (let up = node.parent; up; up = up.parent) {
    out.push(up)
  }
  return out
}

/** A button TalkBack can reach on its own: no `accessible` element above it swallows it. */
function reachableOnItsOwn(node: ReactTestInstance): boolean {
  return !ancestors(node).some((up) => up.props.accessible === true)
}

const styleOf = (node: ReactTestInstance): Record<string, unknown> => Object.assign({}, ...[node.props.style].flat())

describe('a document chip read by TalkBack', () => {
  it.each(SCHEMES)('says the upload failed in the chip label, with Retry and Remove as their own buttons (%s)', (scheme) => {
    const screen = draw(scheme, [{ ...DOC, failed: true }])
    expect(chipFocus(screen).props.accessibilityLabel).toBe('report.pdf, upload failed')
    expect(reachableOnItsOwn(pressable(screen, 'Retry upload'))).toBe(true)
    expect(reachableOnItsOwn(pressable(screen, 'Remove attachment'))).toBe(true)
  })

  it('says it is still uploading, and Remove stays its own button', () => {
    const screen = draw('dark', [{ ...DOC, uploading: true }])
    expect(chipFocus(screen).props.accessibilityLabel).toBe('report.pdf, uploading')
    expect(reachableOnItsOwn(pressable(screen, 'Remove attachment'))).toBe(true)
  })

  it('is read by its name alone once uploaded', () => {
    const screen = draw('light', [DOC])
    expect(chipFocus(screen).props.accessibilityLabel).toBe('report.pdf')
  })

  it('a photo chip says its upload state too', () => {
    const screen = draw('light', [{ ...PHOTO, failed: true }])
    expect(chipFocus(screen).props.accessibilityLabel).toBe('Preview image, upload failed')
    expect(reachableOnItsOwn(pressable(screen, 'Retry upload'))).toBe(true)
  })
})

describe('the remove disc on a chip', () => {
  it.each(SCHEMES)('takes a 48 dp touch that no clipped chip cuts down, round the same 18 dp disc (%s)', (scheme) => {
    const onRemove = vi.fn()
    const screen = draw(scheme, [DOC, PHOTO], onRemove)
    const removes = screen.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Remove attachment')
    expect(removes).toHaveLength(2)
    for (const remove of removes) {
      const target = styleOf(remove)
      expect(target.width).toBeGreaterThanOrEqual(48)
      expect(target.height).toBeGreaterThanOrEqual(48)
      // Nothing above it clips, so the whole target takes touches.
      expect(ancestors(remove).some((up) => styleOf(up).overflow === 'hidden')).toBe(false)
      // The disc drawn is still the app's: 18 dp, in the theme's text colour, its cross in the card fill.
      const disc = remove.find((node) => String(node.type) === 'View' && styleOf(node).width === 18)
      expect(styleOf(disc)).toMatchObject({ width: 18, height: 18, borderRadius: 9, backgroundColor: PALETTE[scheme].text })
      expect(disc.findAll((node) => String(node.type) === 'X')[0]?.props.color).toBe(PALETTE[scheme].attachmentCardFill)
      // Its centre stays 13 dp in from the chip's top end (4 dp inset + 9 dp radius): the target sits
      // in a holder that reaches past the chip by `reach`, given back by a negative margin.
      const holder = remove.parent!
      const reach = styleOf(holder).paddingTop as number
      expect(styleOf(holder)).toMatchObject({ paddingTop: reach, paddingRight: reach, marginTop: -reach, marginRight: -reach })
      expect(target).toMatchObject({ position: 'absolute', top: 0, right: 0 })
      expect((target.height as number) / 2 - reach).toBe(13)
      expect((target.width as number) / 2 - reach).toBe(13)
      // The holder's reach fits the strip's 12 dp gap and top padding, so it never overlaps a neighbour.
      expect(reach).toBeLessThan(12)
    }
    act(() => removes[0]!.props.onPress())
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('doc-1')
  })
})

describe('the extension badge on a document chip', () => {
  it.each(SCHEMES)('truncates a long extension before the remove disc (%s)', (scheme) => {
    const screen = draw(scheme, [{ ...DOC, name: 'site.webmanifest' }])
    const badgeText = screen.root.find((node) => String(node.type) === 'Text' && [node.props.children].flat().join('') === 'WEBMANIFEST')
    expect(badgeText.props.numberOfLines).toBe(1)
    expect(badgeText.props.ellipsizeMode).toBe('tail')
    const badge = styleOf(badgeText.parent!)
    const card = styleOf(screen.root.find((node) => String(node.type) === 'View' && styleOf(node).height === 96 && styleOf(node).borderWidth === 1))
    // The badge's right edge, from the card's left edge, stays clear of the disc (18 dp, 4 dp in).
    const badgeRight = (card.borderWidth as number) + (card.padding as number) + (badge.maxWidth as number)
    expect(badgeRight).toBeLessThanOrEqual((card.width as number) - 4 - 18 - 4)
  })
})
