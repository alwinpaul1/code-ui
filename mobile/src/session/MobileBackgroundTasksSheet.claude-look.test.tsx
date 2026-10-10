// The Background tasks sheet laid out like the Claude Android app's (user screenshot, 2026-10-10).
//
// Each card is darker than the sheet, leads with the kind's glyph (a console for a shell, the hollow
// diamond for an agent), puts the title in body text, and under it "Shell  41s" while running or
// "Shell  Completed" once done. A running card carries a round Stop (a circle outline holding a filled
// square) at its top right; a finished card has none. The fork's own "View transcript" link (and the
// tap that opened a subagent's transcript from a card) is gone at the user's request: it is not in
// Orca. Both themes, from the theme's tokens.

import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileBackgroundTasksSheetBody } from './MobileBackgroundTasksSheet'

vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('lucide-react-native', () => ({
  Activity: 'Activity',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  CircleStop: 'CircleStop',
  Diamond: 'Diamond',
  ListTree: 'ListTree',
  Terminal: 'Terminal',
  X: 'X'
}))

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0)

const ROSTER: AgentSessionBackgroundTaskState = {
  state: 'monitoring',
  supportsTaskStop: true,
  tasks: [
    { id: 'sh-1', kind: 'command', description: 'pnpm dev --port 8081', startedAt: NOW - 41_000 },
    {
      id: 'ag-1',
      kind: 'agent',
      description: 'Audit the release notes',
      startedAt: NOW - (13 * 60_000 + 18_000)
    }
  ],
  settledTasks: [
    { id: 'sh-0', kind: 'command', description: 'pnpm test', state: 'done' },
    { id: 'sh-x', kind: 'command', description: 'pnpm lint', state: 'blocked' }
  ]
}

/** A Claude transcript with one running subagent: the shape that used to draw "View transcript". */
function withRunningSubagent(): NativeChatMessage[] {
  return [
    {
      id: 'a9',
      role: 'assistant',
      timestamp: NOW - 60_000,
      source: 'transcript',
      blocks: [
        {
          type: 'tool-call',
          name: 'Agent',
          input: { description: 'Audit the release notes', subagent_type: 'Explore', prompt: '…' }
        }
      ]
    },
    {
      id: 'r9',
      role: 'user',
      timestamp: NOW - 59_000,
      source: 'transcript',
      blocks: [
        {
          type: 'tool-result',
          output:
            'Async agent launched successfully.\nagentId: a7139263d97426e10 (internal ID - do not mention to user. Only use for AgentOutputTool calls)\noutput_file: /private/tmp/claude-501/tasks/a7139263d97426e10.output'
        }
      ]
    }
  ]
}

function flatStyle(node: ReactTestInstance): Record<string, unknown> {
  const style = typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style
  const list = Array.isArray(style) ? style : [style]
  return Object.assign({}, ...list.filter((entry) => entry && typeof entry === 'object'))
}

describe('the background tasks sheet, laid out like the Claude app', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  async function mount(
    scheme: 'light' | 'dark',
    props: Record<string, unknown> = { hostBackgroundTasks: ROSTER }
  ) {
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(MobileBackgroundTasksSheetBody, { messages: [], ...props } as never)
        )
      )
    })
  }

  const texts = () =>
    renderer!.root
      .findAllByType('Text' as never)
      .map((node) => node.props.children)
      .filter((child): child is string => typeof child === 'string')

  /** A card: the View whose subtree holds its title, nearest to the title. */
  function card(title: string): ReactTestInstance {
    const text = renderer!.root
      .findAllByType('Text' as never)
      .find((node) => node.props.children === title)
    let node: ReactTestInstance | null = text ?? null
    while (node && !(node.props.testID === 'background-task-card')) {
      node = node.parent
    }
    if (!node) {
      throw new Error(`no card for ${title}`)
    }
    return node
  }

  const stopOf = (title: string) =>
    card(title)
      .findAllByType('Pressable' as never)
      .find((node) => node.props.accessibilityLabel === `Stop ${title}`)

  for (const scheme of ['light', 'dark'] as const) {
    const palette = scheme === 'dark' ? darkColors : lightColors

    it(`draws each card darker than the sheet, with the kind's glyph and its meta line (${scheme})`, async () => {
      await mount(scheme)
      expect(flatStyle(card('pnpm dev --port 8081')).backgroundColor).toBe(palette.bgSunken)
      expect(card('pnpm dev --port 8081').findAllByType('Terminal' as never)).toHaveLength(1)
      expect(card('Audit the release notes').findAllByType('Diamond' as never)).toHaveLength(1)
      const all = texts()
      expect(all).toEqual(expect.arrayContaining(['Shell', '41s', 'Agent', '13m 18s', 'Completed', 'Failed']))
      const failed = renderer!.root
        .findAllByType('Text' as never)
        .find((node) => node.props.children === 'Failed')!
      expect(flatStyle(failed).color).toBe(palette.danger)
    })

    it(`puts a round Stop at the top right of a running card only, and it stops that task (${scheme})`, async () => {
      const onStopTask = vi.fn()
      await mount(scheme, { hostBackgroundTasks: ROSTER, onStopTask })
      const stop = stopOf('pnpm dev --port 8081')!
      expect(stop).toBeDefined()
      expect(flatStyle(stop).alignSelf).toBe('flex-start')
      // A circle outline holding a filled square, in the muted foreground.
      const ring = stop.findAll((node) => flatStyle(node).borderRadius === 12 && flatStyle(node).borderWidth !== undefined)
      expect(ring.length).toBeGreaterThan(0)
      expect(flatStyle(ring[0]!).borderColor).toBe(palette.textSecondary)
      const square = stop.findAll((node) => flatStyle(node).backgroundColor === palette.textSecondary)
      expect(square.length).toBeGreaterThan(0)
      await act(async () => {
        stop.props.onPress()
      })
      expect(onStopTask.mock.calls[0]?.[0]).toBe('sh-1')
      expect(stopOf('pnpm test')).toBeUndefined()
      expect(stopOf('pnpm lint')).toBeUndefined()
    })

    it(`shows no View transcript and no card tap on a running Claude subagent (${scheme})`, async () => {
      await mount(scheme, {
        messages: withRunningSubagent(),
        agent: 'claude',
        parentTranscriptPath: '/Users/me/.claude/projects/p/5d877e39.jsonl'
      })
      expect(texts()).toContain('Audit the release notes')
      expect(texts()).not.toContain('View transcript')
      const opens = renderer!.root
        .findAllByType('Pressable' as never)
        .filter((node) => String(node.props.accessibilityLabel ?? '').startsWith('Open '))
      expect(opens).toHaveLength(0)
    })
  }
})
