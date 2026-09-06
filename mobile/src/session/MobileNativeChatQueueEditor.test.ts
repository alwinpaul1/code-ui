import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { MobileNativeChatQueueEditor } from './MobileNativeChatQueueEditor'
vi.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  View: 'View',
  Text: 'Text',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'android' },
  StyleSheet: { create: (styles: unknown) => styles }
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
    'Save',
    'Cancel',
    'Delete message'
  ])
  for (const [label, handler] of [
    ['Save queued message', editor.save],
    ['Cancel queue edit', editor.cancel],
    ['Delete queued message', editor.remove]
  ] as const) {
    act(() => renderer.root.findByProps({ accessibilityLabel: label }).props.onPress())
    expect(handler).toHaveBeenCalledOnce()
  }
  await act(async () => renderer.unmount())
})
