import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'

const flags = vi.hoisted(() => ({ writes: false, dots: [] as unknown[] }))

vi.mock('react-native', () => ({ StyleSheet: { create: <T,>(styles: T) => styles }, Text: 'Text', View: 'View', useColorScheme: () => 'light' }))
vi.mock('./AgentStateDot', () => ({
  AgentStateDot: (props: { state: string }) => {
    flags.dots.push(props.state)
    return null
  }
}))
vi.mock('./MobileAgentIcon', () => ({ MobileAgentIcon: () => null }))
vi.mock('../session/ccr-session-writes', () => ({
  get CCR_SESSION_WRITES() {
    return flags.writes
  }
}))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { noteCcrSessionFacts, resetCcrSessionFactsForTests, CCR_SESSION_FACTS_FRESH_MS } from '../session/ccr-session-facts'
import { parseCcrSessionRow } from '../session/ccr-session-row'
import { resetCcrCacheForTests, setCcrMapping } from '../session/ccr-session-cache'
import { WorktreeAgentRow } from './WorktreeAgentRow'

// A Claude agent row in the workspace list, with its tab's Anthropic session row fresh on the
// phone: its dot follows the session's state as the Claude app files it, and it carries the app's
// "Unread" mark when the row says unread. The mark is drawn only with CCR_SESSION_WRITES on, which
// is also what marks a session read on open: without mark_read the mark would stay on the session
// the user has just read. A Codex row is left exactly as it was.
const NOW = Date.parse('2026-10-15T12:00:00Z')
function agent(overrides: Partial<RuntimeWorktreeAgentRow> = {}): RuntimeWorktreeAgentRow {
  return {
    paneKey: 'tab-1:leaf-1',
    parentPaneKey: null,
    state: 'done',
    agentType: 'claude',
    prompt: 'fix it',
    taskTitle: null,
    displayName: null,
    lastAssistantMessage: 'done',
    toolName: null,
    toolInput: null,
    interrupted: false,
    stateStartedAt: NOW - 1000,
    updatedAt: NOW - 1000,
    ...overrides
  }
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  flags.writes = false
  flags.dots.length = 0
  resetCcrSessionFactsForTests()
  resetCcrCacheForTests()
})

// The phone keys a terminal tab by the host's `<tabId>::<leafId>`; Orca's pane is `<tabId>:<leafId>`.
// The row applies only to the session the tab is matched to (claude-agent-session-state.ts).
function noteRow(fields: Record<string, unknown>) {
  setCcrMapping('tab-1::leaf-1', 'cse_01QXaaaaaaaaaaaaaaaaaaaa', 1, 'acct-1')
  noteCcrSessionFacts('tab-1::leaf-1', 1, parseCcrSessionRow({ id: 'cse_01QXaaaaaaaaaaaaaaaaaaaa', ...fields })!, NOW)
}

function mount(scheme: 'light' | 'dark', row: RuntimeWorktreeAgentRow, now = NOW + 1000) {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>{createElement(WorktreeAgentRow, { agent: row, depth: 0, now, unvisited: false })}</ThemeProvider>
    )
  })
}

const unreadMark = (): ReactTestInstance | undefined => renderer!.root.findAll((node) => String(node.type) === 'View' && node.props.accessibilityLabel === 'Unread')[0]

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('a Claude agent row in %s mode', (scheme, palette) => {
  it('marks an unread session with the app’s Unread mark in the accent token, switch on', () => {
    flags.writes = true
    noteRow({ unread: true })
    mount(scheme, agent())
    expect(unreadMark()?.props.style).toMatchObject({ backgroundColor: palette.accent })
  })

  it('draws no Unread mark while the session writes switch is off', () => {
    noteRow({ unread: true })
    mount(scheme, agent())
    expect(unreadMark()).toBeUndefined()
  })
})

describe('a Claude agent row’s dot', () => {
  it('follows the session asking for input while Orca still says done', () => {
    noteRow({ status: 'requires_action' })
    mount('light', agent({ state: 'done' }))
    expect(flags.dots.at(-1)).toBe('waiting')
  })

  it('goes back to Orca’s state once the session row is no longer fresh', () => {
    noteRow({ status: 'requires_action' })
    mount('light', agent({ state: 'done' }), NOW + CCR_SESSION_FACTS_FRESH_MS)
    expect(flags.dots.at(-1)).toBe('done')
  })

  it('leaves a Codex row as it was, with no Unread mark, whatever the tab’s session row says', () => {
    flags.writes = true
    noteRow({ status: 'requires_action', unread: true })
    mount('light', agent({ agentType: 'codex', state: 'working' }))
    expect(flags.dots.at(-1)).toBe('working')
    expect(unreadMark()).toBeUndefined()
  })
})
