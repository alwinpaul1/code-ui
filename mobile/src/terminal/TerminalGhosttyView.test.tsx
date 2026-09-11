import { createElement, createRef } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalWebViewHandle } from './terminal-webview-contract'

// The native module is Kotlin; stand in with a component that records its
// props and hands back a ref with the two methods the handle drives.
const native = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  writeText: vi.fn(async () => undefined)
}))
vi.mock('expo-libghostty', async () => {
  const React = await import('react')
  return {
    TerminalView: React.forwardRef(function TerminalView(props: Record<string, unknown>, ref) {
      native.props = props
      React.useImperativeHandle(ref, () => ({ writeText: native.writeText, write: vi.fn(), finish: vi.fn() }))
      return null
    })
  }
})
vi.mock('react-native', () => ({
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles }
}))

import { TerminalGhosttyView } from './TerminalGhosttyView'

function mount(overrides: Record<string, unknown> = {}) {
  const ref = createRef<TerminalWebViewHandle>()
  const onModesChanged = vi.fn()
  const onTerminalInput = vi.fn()
  const onWebReady = vi.fn()
  native.props = null
  native.writeText.mockClear()
  act(() => {
    create(
      createElement(TerminalGhosttyView, {
        ref,
        onModesChanged,
        onTerminalInput,
        onWebReady,
        ...overrides
      })
    )
  })
  const fire = (name: string, nativeEvent: unknown) => {
    act(() => {
      ;(native.props![name] as (e: { nativeEvent: unknown }) => void)({ nativeEvent })
    })
  }
  return { ref, onModesChanged, onTerminalInput, onWebReady, fire }
}

describe('the ghostty engine behind the WebView handle', () => {
  it('leaves focus, the keyboard and the accessory row to React Native', () => {
    mount()

    expect(native.props).toMatchObject({
      managesFocus: false,
      showsAccessoryBar: false,
      managesKeyboardInsets: false
    })
  })

  it('draws at 13 dp scaled by the user\'s text size, the size Stage 0 was measured at', () => {
    mount({ textScale: 1.5 })

    expect(native.props?.fontSize).toBe(13 * 1.5)
  })

  it('starts the grid fresh from the host snapshot, and streams writes straight through', () => {
    const { ref } = mount()

    ref.current!.init(51, 38, 'alwinpaul@198 % ')
    ref.current!.write('ls\r\n')

    expect(native.writeText.mock.calls.map(([text]) => text)).toEqual([
      'c[3Jalwinpaul@198 % ',
      'ls\r\n'
    ])
  })

  it('reports the grid the layout produced, not one it was asked for', async () => {
    const { ref, fire, onWebReady } = mount()
    expect(await ref.current!.measureFitDimensions()).toBeNull()

    fire('onResize', { cols: 49, rows: 36 })

    expect(await ref.current!.measureFitDimensions()).toEqual({ cols: 49, rows: 36 })
    expect(onWebReady).toHaveBeenCalledTimes(1)
  })

  it('resolves awaitReady on the first layout, so a measure never races the grid', async () => {
    const { ref, fire } = mount()
    let ready = false
    void ref.current!.awaitReady().then(() => {
      ready = true
    })
    await Promise.resolve()
    expect(ready).toBe(false)

    fire('onResize', { cols: 49, rows: 36 })
    await Promise.resolve()

    expect(ready).toBe(true)
  })

  it("mirrors Claude Code's modes so the gesture gate lets its wheel reports through", () => {
    const { fire, onModesChanged } = mount()

    // Recorded 2026-09-11: 1000|1002|1003|1006 + alt screen.
    fire('onModes', { mask: 0b11111 })

    expect(onModesChanged).toHaveBeenCalledWith(
      expect.objectContaining({ altScreen: true, mouseTrackingMode: 'any', sgrMouseMode: true })
    )
  })

  it('forwards the wheel reports the native scroll encodes as terminal input', () => {
    const { fire, onTerminalInput } = mount()

    fire('onInput', { text: '[<65;10;20M', data: '' })
    fire('onInput', { text: '', data: '' })

    expect(onTerminalInput).toHaveBeenCalledTimes(1)
    expect(onTerminalInput).toHaveBeenCalledWith('[<65;10;20M')
  })

  it("scales its font so the grid matches a host that keeps its own width", () => {
    // Measured: on a 1080 px view at 13 dp the grid is 49 columns; a host that
    // holds 51 (the `hold`/`exhausted` case) addresses cells the view does not
    // have, rows wrap and every partial repaint lands a row off. xterm escaped
    // by CSS-scaling its canvas; the native view scales its font instead.
    const { ref, fire } = mount()
    fire('onResize', { cols: 49, rows: 38 })

    act(() => {
      ref.current!.resize(51, 38)
    })

    expect(native.props?.fontSize).toBeCloseTo((13 * 49) / 51, 5)
  })

  it('leaves the font alone when the host follows the view', () => {
    const { ref, fire } = mount()
    fire('onResize', { cols: 49, rows: 38 })

    act(() => {
      ref.current!.resize(49, 38)
    })

    expect(native.props?.fontSize).toBe(13)
  })
})
