import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { MobileNativeChatQueue } from './MobileNativeChatQueue'

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (styles: unknown) => styles }
}))
vi.mock('./image-preview-store', () => ({ openImagePreview: vi.fn() }))
vi.mock('lucide-react-native', () => ({ Pencil: 'Pencil' }))

// 2026-09-13: a swipe on a long queued message scrolled the whole chat. The
// queue lives in an inverted FlashList, which Android inverts by rotation, so
// the queue's scroller is rotated the same way and its rows rotated back,
// drawn in reverse so they still read top-down.
it('rotates its scroller and rows on Android and draws the rows in reverse', async () => {
  let renderer: ReturnType<typeof create>
  await act(async () => {
    renderer = create(createElement(MobileNativeChatQueue, { messages: ['first', 'second', 'third'] }))
  })
  const scroll = renderer!.root.findByType('ScrollView' as never)
  expect(JSON.stringify(scroll.props.style)).toContain('180deg')
  const labels = renderer!.root
    .findAll((node) => node.type === 'Text' && /^Message \d$/.test(String(node.props.accessibilityLabel)))
    .map((node) => node.props.accessibilityLabel)
  expect(labels).toEqual(['Message 3', 'Message 2', 'Message 1'])
  act(() => renderer!.unmount())
})
