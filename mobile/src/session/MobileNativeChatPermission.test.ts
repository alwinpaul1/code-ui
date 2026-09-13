import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNativeChatPermission } from './MobileNativeChatPermission'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  // The card sizes its reading area against the window so a long prompt cannot
  // push the choices off a short screen.
  useWindowDimensions: () => ({ width: 412, height: 915 })
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
    expect(renderer.root.findByType('Pressable').props.disabled).toBe(true)
    expect(
      renderer.root
        .findAllByType('Text')
        .some((node) => node.props.children === 'Response sent · waiting for agent')
    ).toBe(true)
  })

  it.each([0, 1, 2])(
    'shows sending feedback above the selected choice %i only',
    async (selected) => {
      const options = [
        { label: 'Allow once', send: 'y' },
        { label: "Yes, and don't ask again for commands that start with pnpm test", send: 'p' },
        { label: 'Deny', send: '\x1b' }
      ]
      let finish: (accepted: boolean) => void = () => {}
      const onRespond = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve
          })
      )
      await act(async () => {
        renderer = create(
          createElement(MobileNativeChatPermission, {
            permission: { title: 'Approve?', options },
            onRespond
          })
        )
      })
      act(() => renderer!.root.findAllByType('Pressable')[selected].props.onPress())
      const groups = renderer!.root
        .findAllByType('View')
        .filter(
          (view) =>
            view.findAllByType('Pressable').length === 1 &&
            view.findAllByType('Text').some((text) => text.props.children === 'Sending response…')
        )
      expect(groups).toHaveLength(1)
      expect(groups[0].findByType('Pressable').props.accessibilityLabel).toBe(
        options[selected].label
      )
      expect(
        renderer!.root.findAllByType('Pressable').every((button) => button.props.disabled)
      ).toBe(true)
      expect(
        renderer!.root
          .findAllByType('Pressable')
          .map((button) => button.props.accessibilityState.busy)
      ).toEqual(options.map((_, index) => index === selected))
      expect(onRespond).toHaveBeenCalledExactlyOnceWith(options[selected].send)
      await act(async () => finish(false))
      expect(
        renderer!.root
          .findAllByType('Text')
          .some((text) => text.props.children === 'Sending response…')
      ).toBe(false)
    }
  )

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

  it('keeps the choices reachable when the agent offers many long ones', () => {
    // 2026-09-13, from a screen recording: a long "Allow Bash?" had its buttons
    // under the tools row and the composer, with nothing to tap. The card sits
    // in the dock now, so it must also bound itself — the choices are the only
    // thing the user can act on, so they scroll rather than run off the bottom.
    const options = Array.from({ length: 8 }, (_, index) => ({
      label: `Yes, and don't ask again for commands that start with ${'x'.repeat(120)}${index}`,
      send: String(index)
    }))
    let tree: ReactTestRenderer | null = null
    act(() => {
      tree = create(
        createElement(MobileNativeChatPermission, {
          permission: { title: 'Allow Bash?', detail: 'y'.repeat(4000), options },
          onRespond: vi.fn(async () => true)
        })
      )
    })
    const scrollers = tree!.root.findAllByType('ScrollView')
    const bounded = scrollers.filter((node) => {
      const style = node.props.style as { maxHeight?: number } | undefined
      return typeof style?.maxHeight === 'number' && style.maxHeight > 0
    })
    // Reading area, remembered-scope blocks, and the choices themselves.
    expect(bounded.length).toBeGreaterThanOrEqual(2)
    const choices = scrollers.find((node) =>
      node.findAllByType('Text').some((text) => String(text.props.children).includes('Allow and remember'))
    )
    expect(choices).toBeDefined()
    const choiceStyle = choices!.props.style as { maxHeight?: number; flexShrink?: number }
    expect(choiceStyle.maxHeight).toBeGreaterThan(0)
    expect(choiceStyle.flexShrink).toBe(1)
    act(() => tree!.unmount())
  })
})
