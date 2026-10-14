import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

vi.mock('../components/DraggableDetailSheet', () => ({ DraggableDetailSheet: () => null }))
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): unknown => React.createElement('Text', props, children)
  return {
    Animated: {
      View: 'View',
      Text,
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
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) => React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 360, height: 780, scale: 3, fontScale: 1 })
  }
})
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Copy: 'Copy',
  Image: 'ImageIcon',
  Minus: 'Minus',
  Undo2: 'Undo2',
  X: 'X'
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))

import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { parseTaskNotifications } from './mobile-native-chat-task-notifications'
import {
  COMPLETED_AGENT,
  COMPLETED_BACKGROUND_COMMAND,
  FAILED_BACKGROUND_COMMAND,
  GOAL_CHECK_IN,
  KILLED_BACKGROUND_COMMAND
} from './fixtures/claude-task-notifications-2.1.300'

// User report, 0.9.146: the chat drew a background task's notification as a user bubble of its raw
// XML. The Claude app strips the block and draws the task's state from it; the desktop TUI draws the
// `<summary>` as one line, "⏺ Background command "…" completed (exit code 0)". The records are real
// (fixtures/claude-task-notifications-2.1.300.ts).

const user = (text: string): NativeChatMessage => ({
  id: 'u1',
  role: 'user',
  timestamp: 1,
  source: 'transcript',
  blocks: [{ type: 'text', text }]
})

function everyText(node: ReactTestInstance): string {
  return node
    .findAll((entry) => (entry.type as unknown) === 'Text')
    .map((entry) => [entry.props.children].flat(Infinity).filter((child) => typeof child === 'string').join(''))
    .join('\n')
}
function colorOf(node: ReactTestInstance): string | undefined {
  let found: string | undefined
  for (const entry of [node.props.color, ...[node.props.style].flat(Infinity)]) {
    if (typeof entry === 'string') {
      found = entry
    } else if (entry && typeof entry === 'object' && typeof (entry as { color?: unknown }).color === 'string') {
      found = (entry as { color: string }).color
    }
  }
  return found
}

describe('a background task notification in the chat', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  const render = (text: string, scheme: 'light' | 'dark' = 'light') => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>{createElement(MobileNativeChatMessage, { message: user(text) })}</ThemeProvider>
      )
    })
    return renderer!.root
  }
  const rows = (root: ReactTestInstance) => root.findAll((n) => (n.type as unknown) === 'View' && n.props.testID === 'native-chat-task-notification')

  it('draws a background task notification as a status row, not a user bubble of XML', () => {
    const root = render(FAILED_BACKGROUND_COMMAND)
    expect(rows(root)).toHaveLength(1)
    const shown = everyText(root)
    expect(shown).toContain('Background command "Reconnect adb then install the universal APK" failed with exit code 144')
    expect(shown).not.toContain('<task-notification')
    expect(shown).not.toContain('toolu_012a1vABiDXTT7Ft5z1vHWPs')
    expect(shown).not.toContain('/private/tmp')
  })

  it('draws a finished command the same way', () => {
    const root = render(COMPLETED_BACKGROUND_COMMAND)
    expect(rows(root)).toHaveLength(1)
    expect(everyText(root)).toBe('Background command "Check whether any hostname resolves after the DNS change" completed (exit code 0)')
  })

  it('draws a subagent finishing as its summary, without the report or the usage', () => {
    const root = render(COMPLETED_AGENT)
    expect(everyText(root)).toBe('Agent "Frontend ADR planner UI" finished')
  })

  it('draws two notifications in one record as two rows', () => {
    const root = render(`${FAILED_BACKGROUND_COMMAND}\n${COMPLETED_BACKGROUND_COMMAND}`)
    expect(rows(root)).toHaveLength(2)
  })

  it('keeps the words a person typed after a notification as a normal bubble', () => {
    const root = render(`${FAILED_BACKGROUND_COMMAND}\nretry it on the other cable`)
    expect(rows(root)).toHaveLength(1)
    expect(everyText(root)).toContain('retry it on the other cable')
    expect(everyText(root)).not.toContain('<task-notification')
  })

  it('shows the raw text of a notification that never closes rather than dropping it', () => {
    const cut = FAILED_BACKGROUND_COMMAND.replace('</task-notification>', '')
    const root = render(cut)
    expect(rows(root)).toHaveLength(0)
    expect(everyText(root)).toContain('<task-notification>')
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('colours a failed task with the %s theme\'s danger and a finished one with its success', (scheme, palette) => {
    const failed = render(FAILED_BACKGROUND_COMMAND, scheme)
    expect(colorOf(failed.findByType('X' as never))).toBe(palette.danger)
    act(() => renderer?.unmount())
    const done = render(COMPLETED_BACKGROUND_COMMAND, scheme)
    expect(colorOf(done.findByType('Check' as never))).toBe(palette.success)
  })
})

describe('reading a task notification', () => {
  it('reads each status the real records carry', () => {
    const tones = [
      [FAILED_BACKGROUND_COMMAND, 'failed', 'danger'],
      [COMPLETED_BACKGROUND_COMMAND, 'completed', 'success'],
      [COMPLETED_AGENT, 'completed', 'success'],
      [KILLED_BACKGROUND_COMMAND, 'killed', 'muted']
    ] as const
    for (const [text, status, tone] of tones) {
      expect(parseTaskNotifications(text)?.notifications[0]).toMatchObject({ status, tone })
    }
  })

  it('draws a goal check-in with no status and drops the reminder after it', () => {
    const parsed = parseTaskNotifications(GOAL_CHECK_IN)!
    expect(parsed.notifications).toEqual([
      { status: '', summary: 'Goal check-in: background work still running', tone: 'muted' }
    ])
    expect(parsed.rest).toBe('')
  })

  it('leaves text with no notification, an empty one and a block with no summary alone', () => {
    expect(parseTaskNotifications('')).toBeNull()
    expect(parseTaskNotifications('fix the login')).toBeNull()
    expect(parseTaskNotifications('<task-notification></task-notification>')).toBeNull()
    expect(parseTaskNotifications('<task-notification>\n<status>failed</status>\n</task-notification>')).toBeNull()
  })

  it('leaves a person quoting the tag mid-sentence alone', () => {
    expect(parseTaskNotifications('why does <task-notification> show in the sidebar?')).toBeNull()
  })
})
