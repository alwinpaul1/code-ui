import { createElement, type ReactNode, type ComponentType } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: () => null }))
vi.mock('react-native', async () => {
  const React = await import('react')
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: unknown }) =>
      React.createElement(name, props, children as ReactNode)
  return {
    Animated: {
      View: host('View'),
      Text: host('Text'),
      Value: class {
        constructor(private value: number) {}
        setValue(next: number): void {
          this.value = next
        }
      },
      loop: (animation: unknown) => animation,
      sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
      timing: () => ({ start: vi.fn(), stop: vi.fn() })
    },
    Image: 'Image',
    Platform: { OS: 'android', Version: 34 },
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    Text: host('Text'),
    View: host('View'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
vi.mock('./MobileNativeChatDiffCard', () => ({ MobileNativeChatDiffCard: 'DiffCard', MAX_DIFF_CARD_ROWS: 200 }))
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ visible, header, children }: { visible: boolean; header?: ReactNode; children?: ReactNode }) =>
      visible ? React.createElement('BottomDrawer', null, header, children as ReactNode) : null
  }
})

import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { turnEditedFiles } from './mobile-native-chat-turn-edits'
import { NativeChatAgentRunsContext } from './native-chat-tasks-context'
import { CLAUDE_EDIT_RUN_ROWS } from './fixtures/claude-edit-runs-2.1.282'

const Themed = ThemeProvider as unknown as ComponentType<{ initialPreference: 'light' | 'dark'; children?: ReactNode }>

// 2026-10-15: under a finished turn that edited claude-chat-live.test.ts, Code UI drew "Edited
// claude-chat-live.te… +16 −3 Review"; the Claude app on the same session drew no card, only the run
// row "Ran 3 commands, created a file +23 −0 ›". The app draws its card only when three server flags
// are on (fq6.java case 16: ys6.c4 && k1v.c() — claudeai_hub_cowork_session_chat and
// claudeai_hub_code_session_chat — && ccr_turn_edits_card), and they are off for this user.
// The user: "this review thingy isn't on claude".
const TURN = foldMobileNativeChatMessages(CLAUDE_EDIT_RUN_ROWS)

describe('a finished turn that changed files', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  for (const scheme of ['light', 'dark'] as const) {
    it(`draws no Review card under it, as the Claude app does (${scheme})`, () => {
      act(() => {
        renderer = create(
          createElement(
            Themed,
            { initialPreference: scheme },
            createElement(
              NativeChatAgentRunsContext.Provider,
              { value: { runningIds: new Set<string>(), confirmed: new Map<string, string>(), agentWorking: false } },
              createElement(MobileNativeChatMessage, { message: TURN.at(-1)!, endsTurn: true, turnIsNewest: false, turnEdits: turnEditedFiles(TURN) })
            )
          )
        )
      })
      const root = renderer!.root
      expect(root.findAll((node) => node.props.testID === 'turn-edits-card')).toHaveLength(0)
      expect(root.findAll((node) => node.props.accessibilityLabel === 'Review')).toHaveLength(0)
    })
  }
})
