import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): unknown =>
    React.createElement('Text', props, children)
  return {
    ActivityIndicator: 'ActivityIndicator',
    Pressable: 'Pressable',
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light'
  }
})
vi.mock('lucide-react-native', () => ({ ArrowDown: 'ArrowDown' }))
// The agent's mark is not what these cases are about, and it pulls in SVG.
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: () => null }))

import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { MobileNativeChatListEmpty } from './mobile-native-chat-list-edges'
import { mobileNativeChatEmptyState } from './mobile-native-chat-empty-state'

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function render(
  emptyState: ReturnType<typeof mobileNativeChatEmptyState>,
  scheme: 'light' | 'dark'
): ReactTestRenderer {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatListEmpty emptyState={emptyState} agent="claude" styles={{ center: {} }} />
      </ThemeProvider>
    )
  })
  return renderer!
}

function textNodes(tree: ReactTestRenderer): { text: string; color: string | undefined }[] {
  return tree.root.findAllByType('Text' as never).map((node) => {
    const styles = (Array.isArray(node.props.style) ? node.props.style.flat() : [node.props.style]) as {
      color?: unknown
    }[]
    const color = styles.find((entry) => entry && typeof entry.color === 'string')?.color
    return { text: String(node.children.join('')), color: color as string | undefined }
  })
}

/** A pane whose Claude has taken turns (its Stop hook) but whose status names
 *  no session: the 2026-09-25 split-tab pane, if that was its failure. */
const STATUS_WITHOUT_SESSION: AgentStatusEntry = {
  state: 'done',
  prompt: 'rate the charging stations',
  updatedAt: 0,
  stateStartedAt: 0,
  paneKey: '12eaca17-5ae4-4948-a085-d33f13a25f41:052ceda2-70ad-4c78-ba88-fc99dc338911',
  stateHistory: [],
  agentType: 'claude'
}

describe('the empty chat of a pane that named no session', () => {
  it('says so in a muted line under the invitation, in light and in dark', () => {
    const emptyState = mobileNativeChatEmptyState('waiting-session', 'claude', undefined, {
      agentStatus: STATUS_WITHOUT_SESSION
    })
    for (const [scheme, colors] of [
      ['light', lightColors],
      ['dark', darkColors]
    ] as const) {
      const lines = textNodes(render(emptyState, scheme))
      expect(lines.map((line) => line.text)).toEqual([
        'Start a chat with Claude',
        'Ask Claude to inspect code, explain output, or make a change.',
        'The desktop reports this pane but not which session runs in it, so there is no transcript to read.'
      ])
      expect(lines[2]?.color).toBe(colors.textMuted)
      act(() => renderer?.unmount())
      renderer = null
    }
    expect(darkColors.textMuted).not.toBe(lightColors.textMuted)
  })

  it('draws the plain invitation alone for a tab that has reported nothing yet', () => {
    const lines = textNodes(
      render(mobileNativeChatEmptyState('waiting-session', 'claude', undefined, {}), 'light')
    )
    expect(lines.map((line) => line.text)).toEqual([
      'Start a chat with Claude',
      'Ask Claude to inspect code, explain output, or make a change.'
    ])
  })
})

// The Claude app 1.261013.20 shows a session with no message as "What are we building?" alone
// (rp30.java:882/947/970, `code_empty_what_are_we_building_title`; no subtitle). A matched Claude
// tab reads Anthropic's copy of the session, so its empty conversation is that one.
describe('the empty chat of a Claude tab read from Anthropic', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('reads "What are we building?" alone, as the Claude app does (%s)', (scheme, colors) => {
    const emptyState = mobileNativeChatEmptyState('ready', 'claude', undefined, { anthropicTab: true, agentStatus: STATUS_WITHOUT_SESSION, transcriptMessageCount: 0 })
    const lines = textNodes(render(emptyState, scheme))
    expect(lines.map((line) => line.text)).toEqual(['What are we building?'])
    expect(lines[0]?.color).toBe(colors.text)
  })

  it('keeps the desktop’s words while Orca has not said the session is empty', () => {
    expect(mobileNativeChatEmptyState('awaiting-transcript', 'claude', undefined, { anthropicTab: true })?.title).toBe('Start a chat with Claude')
    expect(mobileNativeChatEmptyState('error', 'claude', 'The desktop could not read this session.', { anthropicTab: true })?.title).toBe('Could not load conversation')
  })

  // The flag is optional all the way down, so a chat that stopped passing it would quietly go back
  // to the desktop's invitation: the overlay hands the view its Anthropic gate, and the view hands
  // it to the empty state (code lines, not comments).
  it('is told the tab is Anthropic’s by the overlay and the view', () => {
    const code = (file: string) => readFileSync(join(__dirname, file), 'utf8').split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n')
    // The overlay draws the view through its shell-command wrapper, which passes every prop on.
    expect(code('MobileNativeChatOverlay.tsx')).toMatch(/<MobileNativeChatShellConfirmView[^>]*?\banthropicTab=\{apiTab\}/)
    expect(code('MobileNativeChatView.tsx')).toMatch(/mobileNativeChatEmptyState\(status, agent \?\? null, error, \{\s*agentStatus, sessionIdentity, anthropicTab,/)
  })

  it('leaves a Codex tab’s invitation as it was', () => {
    expect(mobileNativeChatEmptyState('ready', 'codex', undefined, { anthropicTab: false })?.title).toBe('Start a chat with Codex')
  })
})
