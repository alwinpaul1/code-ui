import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'

// The Claude app's connection row (com.anthropic.claude 1.261009.20, `au8` case 0 and `nl7.b`): the
// status row above the composer, 16 dp above and below, a 16 dp clay mark, an 8 dp gap, then the
// message at 15/400 (`jn7.E`) in the clay `pl7.e`, one line.
vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('./MobileBackgroundTasksPulse', () => ({
  MobileBackgroundTasksPulse: (props: Record<string, unknown>) => createElement('Pulse', props)
}))

import { ThemeProvider } from '../theme/theme-context'
import { ConnectionRowView, MobileNativeChatConnectionRow, connectionNoticeOf } from './MobileNativeChatConnectionRow'
import type { MobileSessionController } from './use-mobile-session-controller'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

type Scheme = 'light' | 'dark'
const palette = (scheme: Scheme) => (scheme === 'light' ? lightColors : darkColors)
function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter((entry) => entry && typeof entry === 'object'))
}
const host = (id: string): ReactTestInstance =>
  renderer!.root.find((node) => node.props.testID === id && typeof node.type === 'string')
const words = (): string[] =>
  renderer!.root.findAll((node) => (node.type as unknown) === 'Text').map((node) => [node.props.children].flat().join(''))

describe.each(['light', 'dark'] as const)('the connection row in %s mode', (scheme) => {
  const show = (kind: 'connecting' | 'lost', text: string) =>
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <ConnectionRowView notice={{ kind, text }} />
        </ThemeProvider>
      )
    })

  it('draws "Connecting..." at 15/400 in the clay, with the mark beside it', () => {
    show('connecting', 'Connecting...')
    expect(words()).toEqual(['Connecting...'])
    const text = renderer!.root.find((node) => (node.type as unknown) === 'Text')
    expect(flat(text.props.style)).toMatchObject({
      fontSize: 15,
      lineHeight: 21,
      color: palette(scheme).composerSend,
      fontFamily: 'InstrumentSans_400Regular'
    })
    expect(renderer!.root.find((node) => (node.type as unknown) === 'Pulse').props).toEqual({
      color: palette(scheme).composerSend,
      breathing: true
    })
  })

  it('draws "Connection lost..." the same way: the app animates the mark under both messages', () => {
    show('lost', 'Connection lost...')
    expect(words()).toEqual(['Connection lost...'])
    expect(renderer!.root.find((node) => (node.type as unknown) === 'Pulse').props.breathing).toBe(true)
  })

  it('is 16 dp tall above and below, with the mark 8 dp from the words, and read out as it changes', () => {
    show('connecting', 'Connecting...')
    const row = host('chat-connection-row')
    expect(flat(row.props.style)).toMatchObject({
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
      gap: 8
    })
    expect(row.props.accessibilityLiveRegion).toBe('polite')
    expect(row.props.accessibilityLabel).toBe('Connecting...')
  })
})

// The row only stands for the status line on the structured lane, whose status line draws no
// working line; everywhere else the status line says it on its own line, as the app's one line
// does (au8 case 0), and a second row would say it twice.
describe('the connected row', () => {
  const controller = (over: {
    connState: string
    verdict: string
    working: boolean
    structured?: boolean
  }): MobileSessionController =>
    ({
      connState: over.connState,
      connectionVerdict: { kind: over.verdict, label: '' },
      nativeChatController: { nativeChatAgentWorking: over.working, nativeChatStructured: over.structured ?? true }
    }) as unknown as MobileSessionController

  it('draws no second row where the status line says "Connecting..." itself', () => {
    const value = controller({ connState: 'reconnecting', verdict: 'normal', working: true, structured: false })
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <MobileNativeChatConnectionRow controller={value} />
        </ThemeProvider>
      )
    })
    expect(renderer!.toJSON()).toBeNull()
    // …while the notice the status line draws is still there.
    expect(connectionNoticeOf(value)).toEqual({ kind: 'connecting', text: 'Connecting...' })
  })
  const mount = (value: MobileSessionController) =>
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <MobileNativeChatConnectionRow controller={value} />
        </ThemeProvider>
      )
    })

  it('says "Connecting..." while a turn runs and the phone is dialling', () => {
    mount(controller({ connState: 'reconnecting', verdict: 'normal', working: true }))
    expect(words()).toEqual(['Connecting...'])
  })

  it('says "Connection lost..." once the phone has judged the host out of reach', () => {
    mount(controller({ connState: 'reconnecting', verdict: 'unreachable', working: true }))
    expect(words()).toEqual(['Connection lost...'])
  })

  it('draws nothing while connected, and nothing while idle', () => {
    mount(controller({ connState: 'connected', verdict: 'normal', working: true }))
    expect(renderer!.toJSON()).toBeNull()
    act(() => renderer?.unmount())
    mount(controller({ connState: 'reconnecting', verdict: 'normal', working: false }))
    expect(renderer!.toJSON()).toBeNull()
  })
})
