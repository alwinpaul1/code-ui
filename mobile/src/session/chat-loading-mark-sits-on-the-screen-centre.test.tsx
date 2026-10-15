import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatTranscriptLoading } from './ClaudeTranscriptLoading'
import { viewportCentreOffset } from './viewport-centre'

// 2026-10-15, from the device: "make the mascot and the loading thingy on the center of the view
// port of the device used". The loading mark (Clawd on a Claude tab, the spinner elsewhere) was
// centred in the space between the header and the composer, and that space is not centred on the
// phone, so the mark sat above the screen's middle. A 2000 dp screen with the space starting at
// 200 and 1500 tall is centred at 950: the mark has to come down 50.
const WINDOW = { width: 400, height: 2000, scale: 3, fontScale: 1 }
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'android', select: (options: { android?: unknown; default?: unknown }) => options.android ?? options.default },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'dark',
  useWindowDimensions: () => WINDOW
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function mount(agent: 'claude' | 'codex', box: { top: number; height: number }, contentHeight: number): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference="dark">
        <MobileNativeChatTranscriptLoading agent={agent} style={{ flex: 1 }} color="#888" />
      </ThemeProvider>,
      { createNodeMock: () => ({ measureInWindow: (done: (x: number, y: number, w: number, h: number) => void) => done(0, box.top, 400, box.height) }) }
    )
  })
  const root = renderer!.root
  const content = root.find((node) => node.props.testID === 'viewport-centred-content')
  const container = content.parent!
  act(() => {
    container.props.onLayout?.({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: box.height } } })
    content.props.onLayout?.({ nativeEvent: { layout: { x: 0, y: 0, width: 200, height: contentHeight } } })
  })
  return root.find((node) => node.props.testID === 'viewport-centred-content')
}

const translateY = (node: ReactTestInstance): unknown =>
  (node.props.style as { transform?: { translateY: number }[] }).transform?.[0]?.translateY

describe('the chat’s loading mark', () => {
  it.each(['claude', 'codex'] as const)('sits on the screen’s centre, not the chat area’s, on a %s tab', (agent) => {
    expect(translateY(mount(agent, { top: 200, height: 1500 }, 120))).toBe(50)
  })

  it('never slides under the header or the composer when the room runs out', () => {
    expect(translateY(mount('claude', { top: 900, height: 400 }, 300))).toBe(-50)
  })
})

describe('the shift to the screen’s centre', () => {
  it('is the gap between the two centres while the container has room', () => {
    expect(viewportCentreOffset({ windowHeight: 2000, containerTop: 200, containerHeight: 1500, contentHeight: 120 })).toBe(50)
    expect(viewportCentreOffset({ windowHeight: 2000, containerTop: 0, containerHeight: 1400, contentHeight: 120 })).toBe(300)
  })

  it('is clamped to the room around the content, and nothing when there is none', () => {
    expect(viewportCentreOffset({ windowHeight: 2000, containerTop: 0, containerHeight: 400, contentHeight: 300 })).toBe(50)
    expect(viewportCentreOffset({ windowHeight: 2000, containerTop: 0, containerHeight: 300, contentHeight: 300 })).toBe(0)
    expect(viewportCentreOffset({ windowHeight: 2000, containerTop: 0, containerHeight: 200, contentHeight: 300 })).toBe(0)
  })

  it('does not move before anything is measured', () => {
    expect(viewportCentreOffset({ windowHeight: 0, containerTop: 0, containerHeight: 1500, contentHeight: 120 })).toBe(0)
    expect(viewportCentreOffset({ windowHeight: 2000, containerTop: 0, containerHeight: 0, contentHeight: 120 })).toBe(0)
    expect(viewportCentreOffset({ windowHeight: 2000, containerTop: Number.NaN, containerHeight: 1500, contentHeight: 120 })).toBe(0)
  })
})
