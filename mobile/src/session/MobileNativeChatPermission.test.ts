import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNativeChatPermission } from './MobileNativeChatPermission'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({ ShieldQuestion: 'ShieldQuestion' }))

describe('MobileNativeChatPermission', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('shows the complete remembered scope and sends only the selected agent response', async () => {
    const prefix = '`python3 /tmp/codeui-network-benchmark.py`'
    const persistentLabel = `Yes, and don't ask again for commands that start with ${prefix}`
    const command = 'python3 /tmp/codeui-network-benchmark.py cold wifi-1'
    const onRespond = vi.fn(async () => true)
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatPermission, {
          permission: {
            title: 'Run this command?',
            detail: `Environment: local\nReason: Measure the connection\n$ ${command}`,
            options: [
              { label: 'Allow once', send: 'y' },
              { label: persistentLabel, send: 'p' },
              { label: 'Deny', send: '\x1b' }
            ]
          },
          onRespond
        })
      )
    })
    const texts = renderer.root.findAllByType('Text')
    expect(texts.some((text) => text.props.children === prefix)).toBe(true)
    expect(texts.some((text) => text.props.children === command && text.props.selectable)).toBe(
      true
    )
    expect(onRespond).not.toHaveBeenCalled()
    const remembered = renderer.root
      .findAllByType('Pressable')
      .find((button) => button.props.accessibilityLabel === persistentLabel)
    await act(async () => remembered?.props.onPress())
    expect(onRespond).toHaveBeenCalledExactlyOnceWith('p')
  })

  it('accepts only one response when two presses land in the same render batch', async () => {
    let resolveResponse: (accepted: boolean) => void = () => {}
    const response = new Promise<boolean>((resolve) => (resolveResponse = resolve))
    const onRespond = vi.fn(() => response)
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatPermission, {
          permission: { title: 'Approve?', options: [{ label: 'Allow', send: '1' }] },
          onRespond
        })
      )
    })
    const button = renderer.root.findByType('Pressable')

    act(() => {
      button.props.onPress()
      button.props.onPress()
    })

    expect(onRespond).toHaveBeenCalledOnce()
    expect(
      renderer.root
        .findAllByType('Text')
        .some((node) => node.props.children === 'Sending response…')
    ).toBe(true)
    expect(renderer.root.findByType('Pressable').props.disabled).toBe(true)
    await act(async () => resolveResponse(true))
    expect(renderer.root.findAllByType('Pressable')).toHaveLength(0)
    expect(
      renderer.root
        .findAllByType('Text')
        .some((node) => node.props.children === 'Response sent · waiting for agent')
    ).toBe(true)
  })

  it('restores choices after a rejected response', async () => {
    const onRespond = vi.fn(async () => false)
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatPermission, {
          permission: { title: 'Approve?', options: [{ label: 'Deny', send: '3' }] },
          onRespond
        })
      )
    })
    await act(async () => renderer.root.findByType('Pressable').props.onPress())
    expect(renderer.root.findByType('Pressable').props.disabled).toBe(false)
    expect(
      renderer.root
        .findAllByType('Text')
        .some((node) => node.props.children === 'Response sent · waiting for agent')
    ).toBe(false)
  })

  it('renders all four Claude choices with full scope and keeps auto mode explicit', async () => {
    const scope = 'pdftoppm -r 110 -f 2 -l 2 -png main.pdf /private/tmp/fig1'
    const auto = 'Yes, and switch to auto mode · auto mode handles these prompts for you'
    const onRespond = vi.fn(async () => true)
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatPermission, {
          permission: {
            title: 'Allow Bash?',
            command: scope,
            options: [
              { label: 'Yes', send: '1' },
              { label: `Yes, and don’t ask again for: ${scope}`, send: '2' },
              { label: auto, send: '3' },
              { label: 'No', send: '4' }
            ]
          },
          onRespond
        })
      )
    })
    const buttons = renderer.root.findAllByType('Pressable')
    expect(buttons).toHaveLength(4)
    const texts = renderer.root.findAllByType('Text')
    expect(texts.some((text) => text.props.children === 'Allow and remember')).toBe(true)
    expect(texts.some((text) => text.props.children === scope && text.props.selectable)).toBe(true)
    expect(onRespond).not.toHaveBeenCalled()
    await act(async () =>
      buttons.find((button) => button.props.accessibilityLabel === auto)?.props.onPress()
    )
    expect(onRespond).toHaveBeenCalledExactlyOnceWith('3')
  })
})
