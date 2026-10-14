import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

vi.mock('react-native', () => ({
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))

import { DictationWaveform } from './DictationWaveform'
import { WAVEFORM_HEIGHT } from './dictation-waveform-geometry'
import type { LevelSource } from '../dictation/pcm-level'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

async function mount(scheme: 'light' | 'dark', width: number): Promise<ReactTestInstance> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <DictationWaveform level={0.5} />
      </ThemeProvider>
    )
  })
  const box = renderer!.root.find((node) => node.props.testID === 'dictation-waveform' && typeof node.type === 'string')
  await act(async () => box.props.onLayout({ nativeEvent: { layout: { width, height: WAVEFORM_HEIGHT } } }))
  return box
}

/** The bar views: absolutely placed children of the waveform's box. */
function bars(box: ReactTestInstance): ReactTestInstance[] {
  return box.findAll((node) => typeof node.type === 'string' && node !== box)
}

describe('the dictation waveform view', () => {
  it('lays out one bar per whole 6 dp pitch of its width, in a 25 dp clipped box', async () => {
    const box = await mount('light', 3 + 30 * 6)
    expect(box.props.style).toMatchObject({ height: 25, overflow: 'hidden' })
    expect(bars(box)).toHaveLength(30)
  })

  it('lays out no bars in a box too narrow for one, and none before it is measured', async () => {
    expect(bars(await mount('light', 5))).toHaveLength(0)
    act(() => renderer?.unmount())
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <DictationWaveform level={1} />
        </ThemeProvider>
      )
    })
    const box = renderer!.root.find((node) => node.props.testID === 'dictation-waveform' && typeof node.type === 'string')
    expect(bars(box)).toHaveLength(0)
  })

  it('draws nothing before its first sample: it grows in from the right as samples arrive', async () => {
    const box = await mount('light', 3 + 10 * 6)
    for (const bar of bars(box)) {
      expect(bar.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ opacity: 0 })]))
    }
  })

  it.each(['light', 'dark'] as const)('inks voice in the primary text colour and silence in the secondary in %s', async (scheme) => {
    const colors = scheme === 'dark' ? darkColors : lightColors
    const box = await mount(scheme, 3 + 4 * 6)
    const views = box.parent!.findAll((node) => typeof node.type === 'function' && 'voicedColor' in node.props)
    expect(views).toHaveLength(4)
    for (const view of views) {
      expect(view.props.voicedColor).toBe(colors.text)
      expect(view.props.silentColor).toBe(colors.textSecondary)
    }
  })
})

describe('the dictation waveform fed by a per-chunk level', () => {
  // The Anthropic engine's level changes about 31 times a second; it reaches the waveform through a
  // subscription, not a prop, so the screen does not re-render per chunk (2026-10-14).
  it('listens to the engine’s level source while mounted, and lets go when it unmounts', async () => {
    const listeners = new Set<(level: number) => void>()
    const source: LevelSource = {
      current: 0.3,
      set: () => {},
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }
    }
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <DictationWaveform level={0} levelSource={source} />
        </ThemeProvider>
      )
    })
    expect(listeners.size).toBe(1)
    act(() => renderer?.unmount())
    renderer = null
    expect(listeners.size).toBe(0)
  })
})
