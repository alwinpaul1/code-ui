import { createElement, createRef } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalWebViewHandle } from './terminal-webview-contract'

// The native module is Kotlin over Termux's Java; stand in with a component that records its
// props and hands back a ref with the commands the handle drives.
const native = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  writeText: vi.fn(async () => undefined),
  cancelSelect: vi.fn(async () => undefined)
}))
vi.mock('@codeui/expo-termux-terminal', async () => {
  const React = await import('react')
  return {
    TermuxTerminalNativeView: React.forwardRef(function TermuxTerminalNativeView(
      props: Record<string, unknown>,
      ref
    ) {
      native.props = props
      React.useImperativeHandle(ref, () => ({
        writeText: native.writeText,
        cancelSelect: native.cancelSelect
      }))
      return null
    })
  }
})
vi.mock('react-native', () => ({
  View: 'View',
  ScrollView: 'ScrollView',
  PixelRatio: { get: () => 2.5 },
  StyleSheet: { create: (styles: unknown) => styles }
}))

import { TerminalTermuxView } from './TerminalTermuxView'

const RESET = '\u001b[?1049l\u001bc'

let renderer: ReturnType<typeof create> | null = null

function mount(overrides: Record<string, unknown> = {}) {
  const ref = createRef<TerminalWebViewHandle>()
  const onModesChanged = vi.fn()
  const onTerminalInput = vi.fn()
  const onTerminalQueryReply = vi.fn()
  const onWebReady = vi.fn()
  native.props = null
  native.writeText.mockClear()
  native.cancelSelect.mockClear()
  act(() => {
    renderer = create(
      createElement(TerminalTermuxView, {
        ref,
        onModesChanged,
        onTerminalInput,
        onTerminalQueryReply,
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
  return { ref, onModesChanged, onTerminalInput, onTerminalQueryReply, onWebReady, fire }
}

describe('the Termux engine behind the terminal handle', () => {
  it("draws at 13 dp scaled by the user's text size, in dp for the native side to scale", () => {
    mount({ textScale: 1.5 })

    expect(native.props?.fontSize).toBe(13 * 1.5)
  })

  it('hands the native view the same palette shape the libghostty view took', () => {
    mount({ terminalTheme: { mode: 'dark', theme: { background: '#101010', foreground: '#f0f0f0' } } })

    expect(native.props?.theme).toMatchObject({ background: '#101010', foreground: '#f0f0f0' })
    expect((native.props!.theme as { palette: unknown[] }).palette).toHaveLength(16)
  })

  it('holds writes until the first grid, because a command before it rejects with "unable to find view"', () => {
    const { ref, fire } = mount()

    ref.current!.write('early\r\n')
    expect(native.writeText).not.toHaveBeenCalled()

    fire('onResize', { cols: 49, rows: 36 })

    expect(native.writeText).toHaveBeenCalledWith('early\r\n')
  })

  it('leaves the alternate screen, resets, then replays the host snapshot, and streams writes through', () => {
    // Termux's RIS erases the screen and transcript but stays on the alternate screen when a
    // program left it there; a snapshot replayed onto that screen would vanish on the next `?1049l`.
    const { ref, fire } = mount()
    fire('onResize', { cols: 49, rows: 36 })

    ref.current!.init(51, 38, 'alwinpaul@198 % ')
    ref.current!.write('ls\r\n')

    expect(native.writeText.mock.calls.map(([text]) => text)).toEqual([
      RESET + 'alwinpaul@198 % ',
      'ls\r\n'
    ])
  })

  it('keeps the grid when the host sends an empty snapshot instead of blanking it', () => {
    const { ref, fire } = mount()
    fire('onResize', { cols: 49, rows: 36 })
    ref.current!.init(51, 38, 'alwinpaul@198 % ')
    native.writeText.mockClear()

    ref.current!.init(51, 38, '')
    ref.current!.init(51, 38, undefined)

    expect(native.writeText).not.toHaveBeenCalled()
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

    fire('onModes', { altScreen: true, mouseTrackingMode: 'drag', sgrMouseMode: true, bracketedPasteMode: true })

    expect(onModesChanged).toHaveBeenCalledWith({
      altScreen: true,
      mouseTrackingMode: 'drag',
      sgrMouseMode: true,
      sgrMousePixelsMode: false,
      bracketedPasteMode: true
    })
  })

  it('forwards the wheel reports the native scroll encodes as terminal input', () => {
    const { fire, onTerminalInput } = mount()

    fire('onInput', { text: '\u001b[<65;10;20M', data: '' })
    fire('onInput', { text: '', data: '' })

    expect(onTerminalInput).toHaveBeenCalledTimes(1)
    expect(onTerminalInput).toHaveBeenCalledWith('\u001b[<65;10;20M')
  })

  it("sends the terminal's own query replies straight to the PTY, not through the gesture gate", () => {
    const { fire, onTerminalInput, onTerminalQueryReply } = mount()

    fire('onInput', { text: '\x1b[?1;2c', data: '' })

    expect(onTerminalQueryReply).toHaveBeenCalledWith('\x1b[?1;2c')
    expect(onTerminalInput).not.toHaveBeenCalled()
  })

  it('swallows what a replayed snapshot makes the emulator emit', async () => {
    // A snapshot's queries were answered as if the agent had just asked (2026-09-13). The guard
    // is scoped to the native writeText promise, so the contract the Kotlin side keeps is that
    // the chunk is parsed and its answers flushed to onInput inside that call, before it
    // settles; this stands in for that with an event fired before the mocked promise resolves.
    const { ref, fire, onTerminalQueryReply } = mount()
    fire('onResize', { cols: 49, rows: 36 })

    ref.current!.init(49, 36, 'prompt \u001b[c')
    fire('onInput', { text: '\x1b[?1;2c', data: '' })
    await act(async () => {
      await Promise.resolve()
    })

    expect(onTerminalQueryReply).not.toHaveBeenCalled()
  })

  // 2026-09-21, from the phone: with the desktop window showing the tab the
  // PTY stays at the desktop's 126 columns, and shrinking 13 dp text until 126
  // columns fit a phone gave 8 px glyphs nobody can read. The old engines did
  // the same. Now the grid is widened to the host's columns at the reader's
  // size and the pane pans sideways; Claude Code keeps its text at the left.
  it('keeps the font at the reader\'s size and widens the grid to pan when the host holds a wider width', () => {
    const { ref, fire } = mount()
    fire('onResize', { cols: 49, rows: 38, cellWidth: 7.8, cellHeight: 15.6 })

    act(() => {
      ref.current!.resize(126, 26)
    })

    expect(native.props?.fontSize).toBe(13)
    // Termux takes floor(width / cellWidth) columns: the host's count plus one pixel.
    expect(native.props?.style).toMatchObject({ width: (126 * 7.8 * 2.5 + 1) / 2.5 })
    expect(native.props?.style).toMatchObject({ width: expect.closeTo(983.2, 3) })
  })

  it('still reports the grid the SCREEN fits, not the widened one, so the host can follow the phone', async () => {
    const { ref, fire } = mount()
    fire('onResize', { cols: 49, rows: 38, cellWidth: 7.8, cellHeight: 15.6 })
    act(() => {
      ref.current!.resize(126, 26)
    })
    // The widened view lays out and reports the host's columns; that is not the fit.
    fire('onResize', { cols: 126, rows: 38, cellWidth: 7.8, cellHeight: 15.6 })

    expect(await ref.current!.measureFitDimensions()).toEqual({ cols: 49, rows: 38 })
  })

  it('returns to the screen width once the host follows the phone again', () => {
    const { ref, fire } = mount()
    fire('onResize', { cols: 49, rows: 38, cellWidth: 7.8, cellHeight: 15.6 })
    act(() => {
      ref.current!.resize(126, 26)
    })
    fire('onResize', { cols: 126, rows: 38, cellWidth: 7.8, cellHeight: 15.6 })

    act(() => {
      ref.current!.resize(49, 38)
    })

    expect(native.props?.style).not.toMatchObject({ width: expect.any(Number) })
  })

  it("sits a host's shorter grid at the bottom of the pane, so its prompt row is over the keyboard, not mid-screen", () => {
    const { ref, fire } = mount()
    fire('onResize', { cols: 49, rows: 38, cellWidth: 7.8, cellHeight: 15.6 })

    act(() => {
      ref.current!.resize(126, 26)
    })

    expect(native.props?.style).toMatchObject({ height: (26 * 15.6 * 2.5 + 1) / 2.5 })
    const pane = renderer!.root.findAllByType('View' as never).find((node) => node.props.testID === 'termux-terminal-pane')
    expect(pane?.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ justifyContent: 'flex-end' })]))
  })

  it('scales the font UP for a host narrower than the phone, so the text fills the width', () => {
    const { ref, fire } = mount()
    fire('onResize', { cols: 49, rows: 38, cellWidth: 7.8, cellHeight: 15.6 })

    act(() => {
      ref.current!.resize(45, 38)
    })

    expect(native.props?.fontSize).toBeCloseTo((13 * 49) / 45, 5)
    expect(native.props?.style).not.toMatchObject({ width: expect.any(Number) })
  })

  it('leaves the font alone when the host follows the view', () => {
    const { ref, fire } = mount()
    fire('onResize', { cols: 49, rows: 38, cellWidth: 7.8, cellHeight: 15.6 })

    act(() => {
      ref.current!.resize(49, 38)
    })

    expect(native.props?.fontSize).toBe(13)
  })

  it('opens the keyboard for a native tap on plain text', () => {
    const onTerminalTap = vi.fn()
    const { fire } = mount({ onTerminalTap })

    fire('onTap', { line: '$ ls -la', col: 3, row: 5 })

    expect(onTerminalTap).toHaveBeenCalledTimes(1)
  })

  it('opens a file path or a URL under the finger instead of the keyboard', () => {
    const onTerminalTap = vi.fn()
    const onFileTap = vi.fn()
    const onOpenUrl = vi.fn()
    const { fire } = mount({ onTerminalTap, onFileTap, onOpenUrl })

    fire('onTap', { line: 'see file:///Users/me/app/src/index.ts#L12', col: 12, row: 1 })
    expect(onFileTap).toHaveBeenCalledWith('/Users/me/app/src/index.ts', 12, null)

    fire('onTap', { line: 'docs at https://example.com/guide today', col: 14, row: 2 })
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/guide')
    expect(onTerminalTap).not.toHaveBeenCalled()
  })

  it('forwards the caret metrics the keyboard avoidance lift reads', () => {
    const onKeyboardAvoidanceMetrics = vi.fn()
    const { fire } = mount({ onKeyboardAvoidanceMetrics })

    fire('onMetrics', { cursorY: 20, contentBottomRow: 22, rows: 38, altScreen: false })

    expect(onKeyboardAvoidanceMetrics).toHaveBeenCalledWith({
      cursorY: 20,
      contentBottomRow: 22,
      rows: 38,
      altScreen: false
    })
  })

  it('snaps a pinch step to the nearest text-size preset', () => {
    // The native side steps 13 dp by 1.25 per pinch and never resizes itself; the preset it
    // lands on comes back as the fontSize prop.
    const onTextScaleChange = vi.fn()
    const { fire } = mount({ onTextScaleChange })

    fire('onFontSize', { fontSize: 13 * 1.25 })
    expect(onTextScaleChange).toHaveBeenLastCalledWith(1.25)
    fire('onFontSize', { fontSize: 13 * 1.5 * 1.25 })
    expect(onTextScaleChange).toHaveBeenLastCalledWith(2)
    fire('onFontSize', { fontSize: 13 / 1.25 })
    expect(onTextScaleChange).toHaveBeenLastCalledWith(0.75)
  })

  it('reports selection and copy to the host exactly as the other engines do', () => {
    const onSelectionMode = vi.fn()
    const onSelectionCopy = vi.fn()
    const onHaptic = vi.fn()
    const { fire } = mount({ onSelectionMode, onSelectionCopy, onHaptic })

    fire('onSelection', { active: true })
    expect(onHaptic).toHaveBeenCalledWith('selection')
    fire('onCopy', { text: 'npm test' })
    fire('onSelection', { active: false })

    expect(onSelectionMode.mock.calls.map(([a]) => a)).toEqual([true, false])
    expect(onSelectionCopy).toHaveBeenCalledWith('npm test')
  })

  it('clears with the same reset bytes a snapshot gets, once it has a grid', () => {
    // Termux's reset() touches no cell and clearTranscript() lands on whichever buffer is
    // current; the RIS byte sequence is what erases the screen and drops the main transcript.
    const { ref, fire } = mount()
    ref.current!.clear()
    ref.current!.cancelSelect()
    expect(native.writeText).not.toHaveBeenCalled()

    fire('onResize', { cols: 49, rows: 36 })

    expect(native.writeText).toHaveBeenCalledWith(RESET)
    expect(native.cancelSelect).toHaveBeenCalledTimes(1)
  })

  it('hands the native scheme only #rrggbb, with CSS alpha dropped', () => {
    mount({ terminalTheme: { mode: 'dark', theme: { background: 'rgba(16,16,16,0.9)', red: '#ff000080' } } })

    const theme = native.props!.theme as { background: string; palette: (string | null)[] }
    expect(theme.background).toBe('#101010')
    expect(theme.palette[1]).toBe('#ff0000')
  })

  it('splits a payload that answers two queries at once, so neither is dropped by the gesture gate', () => {
    // The native side flushes per chunk; Claude Code's startup probes can share a chunk.
    const { fire, onTerminalInput, onTerminalQueryReply } = mount()

    fire('onInput', { text: '\x1b[?1;2c\x1b[38;1R', data: '' })

    expect(onTerminalQueryReply.mock.calls.map(([r]) => r)).toEqual(['\x1b[?1;2c', '\x1b[38;1R'])
    expect(onTerminalInput).not.toHaveBeenCalled()
  })
})
