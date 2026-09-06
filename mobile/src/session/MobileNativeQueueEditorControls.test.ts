import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { MobileNativeQueueEditorControls } from './MobileNativeQueueEditorControls'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (styles: unknown) => styles }
}))

it.each(['claude', 'codex'] as const)(
  'provides %s native editing keys without automatically recalling, submitting or interrupting',
  async (agent) => {
    const onKey = vi.fn()
    const onClose = vi.fn()
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        createElement(MobileNativeQueueEditorControls, { agent, enabled: true, onKey, onClose })
      )
    })
    expect(onKey).not.toHaveBeenCalled()
    const buttons = renderer.root.findAllByType('Pressable')
    const recall = buttons.find(
      (node) => node.props.accessibilityLabel === (agent === 'codex' ? 'Send Alt+↑' : 'Send ↑')
    )!
    act(() => recall.props.onPress())
    expect(onKey).toHaveBeenLastCalledWith({ bytes: agent === 'codex' ? '\x1b[1;3A' : '\x1b[A' })
    const submit = buttons.find(
      (node) => node.props.accessibilityLabel === (agent === 'codex' ? 'Send Tab' : 'Send Enter')
    )!
    act(() => submit.props.onPress())
    expect(onKey).toHaveBeenLastCalledWith({ bytes: agent === 'codex' ? '\t' : '\r' })
    act(() => buttons[0]!.props.onPress())
    expect(onClose).toHaveBeenCalledOnce()
    expect(onKey).toHaveBeenCalledTimes(2)
    await act(async () =>
      renderer.update(
        createElement(MobileNativeQueueEditorControls, { agent, enabled: false, onKey, onClose })
      )
    )
    expect(
      renderer.root
        .findAllByType('Pressable')
        .slice(1)
        .every((node) => node.props.disabled)
    ).toBe(true)
    await act(async () => renderer.unmount())
  }
)
