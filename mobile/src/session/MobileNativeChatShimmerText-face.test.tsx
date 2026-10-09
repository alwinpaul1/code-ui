import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { selectActiveToolCall } from '../../../src/shared/native-chat-tool-activity'
import { installInstrumentSansText } from '../theme/instrument-sans-text'
import { fontFamily } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { MobileNativeChatAgentRun } from './MobileNativeChatAgentRun'
import { ToolRun } from './MobileNativeChatToolRun'
import { NativeChatAgentRunsContext } from './native-chat-tasks-context'

// React Native's Text as patches/react-native@0.86.3.patch leaves it
// (Libraries/Text/Text.js, the hunk at 168): EVERY Text, a nested span
// included, runs its own style through global.__codeUiTextStyle before the
// nested-text branch. A span whose style names no face is handed Instrument
// Sans Regular, and a span's own family beats the paragraph's.
vi.mock('react-native', async () => {
  const React = await import('react')
  function flatten(style: unknown): Record<string, unknown> | undefined {
    if (style == null || style === false) {
      return undefined
    }
    if (Array.isArray(style)) {
      return Object.assign({}, ...style.map((entry) => flatten(entry) ?? {}))
    }
    return style as Record<string, unknown>
  }
  const Text = ({ style, children, ...props }: { style?: unknown; children?: ReactNode }) => {
    const hook = (globalThis as { __codeUiTextStyle?: (style: unknown) => unknown }).__codeUiTextStyle
    return React.createElement('Text', { ...props, style: hook ? hook(style) : style }, children)
  }
  return {
    Image: 'Image',
    Platform: { OS: 'android', Version: 34, select: (options: Record<string, unknown>) => options.android },
    Pressable: 'Pressable',
    StyleSheet: { create: <T,>(styles: T) => styles, flatten, hairlineWidth: 1 },
    Text,
    View: 'View',
    useColorScheme: () => 'light'
  }
})
// Reanimated's Animated.Text is createAnimatedComponent(Text): React Native's
// own Text, patch and all.
vi.mock('react-native-reanimated', async () => {
  const { Text } = await import('react-native')
  return {
    default: { Text },
    Easing: { linear: (t: number) => t },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: <T,>(factory: () => T) => factory(),
    withTiming: (to: number) => to,
    withRepeat: (value: number) => value,
    cancelAnimation: () => undefined,
    interpolateColor: (_value: number, _input: number[], output: string[]) => output[0]
  }
})
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('lucide-react-native', () =>
  Object.fromEntries(
    ['ChevronDown', 'ChevronRight', 'Circle', 'CircleCheck', 'CircleDot', 'ListChecks', 'SquareChevronRight', 'SquareTerminal', 'Wrench'].map((name) => [name, name])
  )
)
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))

installInstrumentSansText()

/** A live turn, so an Agent call with no answer yet is still running. */
const LIVE_TURN = { runningIds: new Set<string>(), confirmed: new Map<string, string>(), agentWorking: true }

/** An Agent call still being made: the turn is live and it has no answer yet. */
const RUNNING_AGENT: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Agent', input: { description: 'Fix the chat rows', prompt: 'Fix them.' } }
]
const LIVE_SHELL_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'shell', input: { command: 'pnpm test' }, state: 'running' }
]

function AgentRow() {
  const styles = useChatMessageStyles()
  return createElement(MobileNativeChatAgentRun, { blocks: RUNNING_AGENT, styles })
}

function ToolRow() {
  const styles = useChatMessageStyles()
  return createElement(ToolRun, {
    blocks: LIVE_SHELL_RUN,
    defaultExpanded: false,
    activeCall: selectActiveToolCall(LIVE_SHELL_RUN, { activeTurnIsWorking: true }),
    styles
  })
}

function faceOf(node: ReactTestInstance): unknown {
  return [node.props.style].flat(3).reduce<unknown>(
    (found, entry) => (entry as { fontFamily?: unknown } | null)?.fontFamily ?? found,
    undefined
  )
}

describe('the face a running label keeps while it shimmers', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function draw(row: () => React.JSX.Element, scheme: 'light' | 'dark', testID: string) {
    act(() => {
      renderer?.unmount()
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <NativeChatAgentRunsContext.Provider value={LIVE_TURN}>
            {createElement(row)}
          </NativeChatAgentRunsContext.Provider>
        </ThemeProvider>
      )
    })
    const label = renderer!.root.find((node) => node.props.testID === testID && String(node.type) === 'Text')
    const glyphs = label.findAll((node) => String(node.type) === 'Text' && node !== label)
    return { label, glyphs }
  }

  // Code review of c03f5328: the swept "Running agent" drew in Regular where
  // the plain label is Medium. Each glyph span named no face, so the patched
  // Text gave it Regular, and the narrower word pulled the chevron sideways
  // when the sweep started and stopped.
  it('keeps "Running agent: <subject>" in Medium while it sweeps, in light and dark', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const { label, glyphs } = draw(AgentRow, scheme, 'agent-run-label')
      expect(glyphs.map((glyph) => String(glyph.props.children)).join('')).toBe('Running agent: Fix the chat rows')
      expect(faceOf(label)).toBe(fontFamily.medium)
      expect(new Set(glyphs.map(faceOf))).toEqual(new Set([fontFamily.medium]))
    }
  })

  it('keeps the running tool row\'s "Running" in its own Regular while it sweeps, in light and dark', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const { label, glyphs } = draw(ToolRow, scheme, 'tool-run-active-label')
      expect(glyphs.map((glyph) => String(glyph.props.children)).join('')).toBe('Running')
      expect(faceOf(label)).toBe(fontFamily.regular)
      expect(new Set(glyphs.map(faceOf))).toEqual(new Set([fontFamily.regular]))
    }
  })
})
