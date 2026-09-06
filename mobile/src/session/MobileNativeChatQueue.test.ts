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
vi.mock('lucide-react-native', () => ({ Pencil: 'Pencil' }))

it.each(['claude', 'codex'])(
  'offers a pencil for a %s desktop queue without any phone pending messages',
  async (agent) => {
    const onEdit = vi.fn().mockResolvedValue(undefined)
    const projected = projectMobileChatQueue([], ['desktop-only message'])
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatQueue, { messages: projected.queue, agent, onEdit })
      )
    })
    expect(renderer!.root.findAllByType('Pencil')).toHaveLength(1)
    const button = renderer!.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityRole === 'button')!
    await act(async () => button.props.onPress())
    expect(onEdit).toHaveBeenCalledOnce()
    await act(async () => renderer!.unmount())
  }
)

it('shows the desktop-confirmed image queue with a caption and tappable thumbnail only once', async () => {
  const path =
    '/var/folders/0y/session/T/orca-paste-1788712836417-a0492b73-30c3-4c2f-9f7c-c9b7ca928614.png'
  const projected = projectMobileChatQueue(
    [
      { text: 'Same message', images: ['file:///photo.png'] },
      { text: 'Second message', images: ['file:///second.png'] }
    ],
    [path + ' Same message', path + ' Second message']
  )
  expect(projected.pending).toEqual([])
  let renderer: ReturnType<typeof create>
  await act(async () => {
    renderer = create(createElement(MobileNativeChatQueue, { messages: projected.queue }))
  })
  const text = renderer!.root.findAllByType('Text').map((node) => node.props.children)
  expect(text).toContain('Queued on agent · 2')
  expect(text).toContain('Message 1')
  expect(text).toContain('Message 2')
  expect(text.filter((value) => value === 'Second message')).toHaveLength(1)
  expect(text).toContain('Same message')
  expect(text.join(' ')).not.toContain(path)
  expect(renderer!.root.findAllByType('ScrollView')).toHaveLength(1)
  expect(renderer!.root.findAllByType('Image').map((node) => node.props.source)).toEqual([
    { uri: 'file:///photo.png' },
    { uri: 'file:///second.png' }
  ])
  act(() => renderer!.root.findAllByType('Pressable')[0]!.props.onPress())
  expect(openImagePreview).toHaveBeenCalledWith('file:///photo.png', 'Queued image')
  act(() => renderer!.unmount())
})
