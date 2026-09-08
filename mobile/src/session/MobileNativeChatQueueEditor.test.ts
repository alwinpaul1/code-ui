import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { MobileNativeChatQueueEditor } from './MobileNativeChatQueueEditor'
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  ScrollView: 'ScrollView',
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  View: 'View',
  Text: 'Text',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'android' },
  StyleSheet: { create: (styles: unknown) => styles }
}))
vi.mock('lucide-react-native', () => ({ Check: 'Check', Trash2: 'Trash2', X: 'X' }))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 })
}))
it('edits in a chat text field with short actions and no terminal instructions', async () => {
  const editor = {
    text: 'desktop message',
    busy: false,
    error: null,
    setText: vi.fn(),
    save: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn(),
    dismiss: vi.fn()
  }
  let renderer!: ReturnType<typeof create>
  await act(async () => {
    renderer = create(createElement(MobileNativeChatQueueEditor, { editor }))
  })
  const input = renderer.root.findByType('TextInput')
  expect(input.props.value).toBe('desktop message')
  act(() => input.props.onChangeText('updated message'))
  expect(editor.setText).toHaveBeenCalledWith('updated message')
  expect(renderer.root.findAllByType('Text').map((node) => node.props.children)).toEqual([
    'Edit queued message',
    // The agent is holding this text for as long as the sheet is open, and
    // closing without saving leaves it there. Say so.
    'This message is in the agent\u2019s input while this is open. Save or Cancel puts it back.',
    'Cancel',
    'Save'
  ])
  for (const [label, handler] of [
    ['Save queued message', editor.save],
    ['Cancel queue edit', editor.cancel],
    ['Delete queued message', editor.remove]
  ] as const) {
    act(() => renderer.root.findByProps({ accessibilityLabel: label }).props.onPress())
    expect(handler).toHaveBeenCalledOnce()
  }
  act(() =>
    renderer.root
      .findByProps({ accessibilityLabel: 'Cancel changes to queued message' })
      .props.onPress()
  )
  expect(editor.cancel).toHaveBeenCalledTimes(2)
  await act(async () => {
    renderer.update(
      createElement(MobileNativeChatQueueEditor, { editor: { ...editor, busy: true } })
    )
  })
  expect(renderer.root.findByType('TextInput').props.editable).toBe(false)
  for (const button of renderer.root.findAllByType('Pressable')) {
    expect(button.props.disabled).toBe(true)
  }
  act(() => renderer.root.findByType('Modal').props.onRequestClose())
  expect(editor.cancel).toHaveBeenCalledTimes(2)
  await act(async () => renderer.unmount())
})


it('renders the stranded messages as selectable rows and stops accepting edits', async () => {
  // The list of messages that left the queue is the only copy left. Editing the
  // box after a strand changed the editor's identity, which re-armed the
  // teardown and threw the list away before it could be copied.
  const editor = {
    text: 'alpha edited',
    busy: false,
    error: '2 messages left the queue. Copy them before closing: "bravo second", "charlie third"',
    movesToEnd: false,
    stranded: true,
    remaining: ['bravo second', 'charlie third'],
    rebuilds: true,
    setText: vi.fn(),
    save: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn(),
    dismiss: vi.fn()
  }
  let renderer!: ReturnType<typeof create>
  await act(async () => {
    renderer = create(createElement(MobileNativeChatQueueEditor, { editor }))
  })
  const rendered = renderer.root.findAllByType('Text').map((node) => node.props.children)
  expect(rendered).toContain('bravo second')
  expect(rendered).toContain('charlie third')
  // Every write action is off, so a text box that still takes input can only
  // lose the list.
  expect(renderer.root.findByType('TextInput').props.editable).toBe(false)
  expect(rendered).toContain('Close')
  await act(async () => renderer.unmount())
})
