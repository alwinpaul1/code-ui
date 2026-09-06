import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { MobileNativeChatQueue } from './MobileNativeChatQueue'
import { projectMobileChatQueue } from './mobile-terminal-queued-messages'
import { openImagePreview } from './image-preview-store'
vi.mock('react-native', () => ({
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (styles: unknown) => styles }
}))
vi.mock('./image-preview-store', () => ({ openImagePreview: vi.fn() }))

it('shows the desktop-confirmed image queue with a caption and tappable thumbnail only once', async () => {
  const path =
    '/var/folders/0y/session/T/orca-paste-1788712836417-a0492b73-30c3-4c2f-9f7c-c9b7ca928614.png'
  const projected = projectMobileChatQueue(
    [{ text: 'Same message', images: ['file:///photo.png'] }],
    [path + ' Same message']
  )
  expect(projected.pending).toEqual([])
  let renderer: ReturnType<typeof create>
  await act(async () => {
    renderer = create(createElement(MobileNativeChatQueue, { messages: projected.queue }))
  })
  const text = renderer!.root.findAllByType('Text').map((node) => node.props.children)
  expect(text).toContain('Queued on agent · 1')
  expect(text).toContain('Same message')
  expect(text.join(' ')).not.toContain(path)
  expect(renderer!.root.findByType('Image').props.source).toEqual({ uri: 'file:///photo.png' })
  act(() => renderer!.root.findByType('Pressable').props.onPress())
  expect(openImagePreview).toHaveBeenCalledWith('file:///photo.png', 'Queued image')
  act(() => renderer!.unmount())
})
