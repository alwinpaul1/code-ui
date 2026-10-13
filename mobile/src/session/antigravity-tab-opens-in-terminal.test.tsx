import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement, useRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import {
  resetSessionViewPreferenceMemoryForTests,
  saveDefaultSessionView,
  updateSessionViewOverride
} from '../storage/session-view-preferences'
import { consumeAgentHudBeacons, resetAgentHudBeacons } from './agent-hud-beacon'
import { shouldShowTerminalCommandDock } from './mobile-session-command-dock-visibility'
import { mobileNativeChatFrameToShow } from './mobile-native-chat-frame-decision'
import type { MobileNativeChatTab } from './mobile-native-chat-eligibility'
import { useMobileNativeChatActiveResolution } from './use-mobile-native-chat-active-resolution'

// Reported from the phone on 0.9.131 (2026-10-13), with a screenshot: a
// terminal tab opened on the desktop beforehand ("Terminal 1", the Antigravity
// icon on its pill, `agy` running in it) came up on the phone as a chat. The
// body was empty, a chat composer read "Waiting for terminal…", and under it
// sat the terminal's own key row and "Type a command…" bar. Code UI can chat
// with Claude Code, Codex and Grok; Antigravity is none of them, so the tab
// must be a plain terminal, its pane on screen and no chat composer over it.
//
// The status is Orca's tab status for an Antigravity pane: the agent type the
// desktop names (src/shared/agent-kind.ts, 'antigravity') and the provider
// session its hook carries, a `conversationId` with no transcript path
// (extractAgentProviderSession in src/shared/agent-session-resume.ts).

vi.mock('expo-router', async () => {
  const react = await import('react')
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      react.useEffect(() => effect(), [effect])
    }
  }
})

const HOST = 'host-1'
const WORKTREE = 'repo-1::/Users/me/codeui'
const HANDLE = 'pty-terminal-1'

function antigravityStatus(): AgentStatusEntry {
  return {
    state: 'done',
    prompt: '',
    updatedAt: 1,
    stateStartedAt: 1,
    paneKey: 'tab-ag:leaf-1',
    agentType: 'antigravity',
    providerSession: { key: 'conversation_id', id: '7f3c2a10-agy-conversation' }
  } as AgentStatusEntry
}

function claudeStatus(): AgentStatusEntry {
  return {
    state: 'done',
    prompt: '',
    updatedAt: 1,
    stateStartedAt: 1,
    paneKey: 'tab-cc:leaf-1',
    agentType: 'claude',
    providerSession: {
      key: 'session_id',
      id: '0b6f4c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b',
      transcriptPath: '/Users/me/.claude/projects/-Users-me-codeui/0b6f4c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b.jsonl'
    }
  } as AgentStatusEntry
}

type Tab = MobileNativeChatTab & { id: string }

const antigravityTab = (agentStatus: AgentStatusEntry | null = antigravityStatus()): Tab => ({
  type: 'terminal',
  id: 'tab-ag::leaf-1',
  agentStatus
})

const claudeTab: Tab = {
  type: 'terminal',
  id: 'tab-cc::leaf-1',
  launchAgent: 'claude',
  agentStatus: claudeStatus()
}

/** One real beacon frame in the old OSC shape a Claude Code launch writes to
 *  its own PTY; still read from tabs launched before the C0 frame. */
function claudeBeacon(): string {
  return `${String.fromCharCode(27)}]7777;CUIHUD1 agent=claude model=claude-opus-5${String.fromCharCode(7)}`
}

type Screen = {
  /** The chat overlay draws a chat (its composer with it). */
  chatComposer: boolean
  /** The terminal's own input bar sits under the session. */
  terminalDock: boolean
  /** The overlay yields, so the terminal pane under it is what shows. */
  terminalPane: boolean
  /** The header offers a Chat/Terminal toggle. */
  chatToggle: boolean
}

function mountTab(initial: Tab, handle: string | null) {
  let latest: Screen | null = null
  function Probe({ tab, activeHandle, paneMounted }: { tab: Tab; activeHandle: string | null; paneMounted: boolean }) {
    const ref = useRef<string | null>(activeHandle)
    ref.current = activeHandle
    const resolution = useMobileNativeChatActiveResolution({
      hostId: HOST,
      worktreeId: WORKTREE,
      activeSessionTab: tab,
      activeSessionTabId: tab.id,
      activeHandle,
      activeHandleRef: ref,
      nativeChatTranscriptIsLocalReadable: true,
      watching: true
    })
    // The overlay's own inputs, as MobileNativeChatOverlay computes them for a
    // tab whose transcript has nothing loading.
    const chatOn = resolution.showNativeChat || resolution.chatViewSelected
    const frame = mobileNativeChatFrameToShow({
      blank: !chatOn,
      showNativeChat: chatOn,
      hasHeldFrame: false,
      hasTerminalUnderneath: paneMounted,
      ptyTab: tab.type === 'terminal'
    })
    latest = {
      chatComposer: frame !== 'terminal',
      terminalPane: frame === 'terminal',
      terminalDock: shouldShowTerminalCommandDock({
        blockedByOtherPanel: false,
        showNativeChat: resolution.showNativeChat,
        chatViewSelected: resolution.chatViewSelected,
        agentSession: false,
        viewResolved: resolution.viewResolved,
        loading: false
      }),
      chatToggle: resolution.activeChatEligible
    }
    return null
  }
  let renderer!: ReactTestRenderer
  let props = { tab: initial, activeHandle: handle, paneMounted: handle != null }
  act(() => {
    renderer = create(createElement(Probe, props))
  })
  return {
    get screen(): Screen {
      if (!latest) {
        throw new Error('probe never rendered')
      }
      return latest
    },
    async update(next: Partial<typeof props>) {
      props = { ...props, ...next }
      await act(async () => {
        renderer.update(createElement(Probe, props))
        await Promise.resolve()
      })
    },
    async settle() {
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
    },
    unmount() {
      act(() => renderer.unmount())
    }
  }
}

describe('a tab running an agent the phone cannot chat with', () => {
  let mounted: ReturnType<typeof mountTab> | null = null

  beforeEach(async () => {
    // A view chosen in one case must not carry into the next.
    await AsyncStorage.clear()
    resetSessionViewPreferenceMemoryForTests()
    resetAgentHudBeacons()
    // The shipped device default: agent tabs open in Chat UI.
    await saveDefaultSessionView('chat')
  })

  afterEach(() => {
    mounted?.unmount()
    mounted = null
  })

  it('opens an already-open Antigravity tab in the terminal view, with its output and no chat composer', async () => {
    // The pane ran Claude Code before `agy` (its beacon is still the last word
    // the phone heard on this PTY), and the tab was left in Chat UI then.
    await updateSessionViewOverride(HOST, WORKTREE, antigravityTab().id, 'chat')
    consumeAgentHudBeacons(HANDLE, claudeBeacon())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    mounted = mountTab(antigravityTab(), HANDLE)
    await mounted.settle()

    expect(mounted.screen).toEqual({
      chatComposer: false,
      terminalPane: true,
      terminalDock: true,
      chatToggle: false
    })
    // The kept Chat UI choice is set aside with a line that says why.
    expect(warn.mock.calls.some(([line]) => String(line).includes('runs antigravity, which has no Chat UI'))).toBe(true)
    warn.mockRestore()
  })

  it('keeps an Antigravity tab Orca launched in the terminal view before its first status arrives', async () => {
    // Orca's launch record names the agent at once; its hook has not posted
    // yet. A Chat UI choice kept for the tab must not draw an empty chat.
    const launched: Tab = { type: 'terminal', id: 'tab-ag::leaf-1', launchAgent: 'antigravity' }
    await updateSessionViewOverride(HOST, WORKTREE, launched.id, 'chat')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    mounted = mountTab(launched, HANDLE)
    await mounted.settle()

    expect(mounted.screen).toEqual({
      chatComposer: false,
      terminalPane: true,
      terminalDock: true,
      chatToggle: false
    })
    expect(warn.mock.calls.some(([line]) => String(line).includes('runs antigravity, which has no Chat UI'))).toBe(true)
    warn.mockRestore()
  })

  it('keeps the terminal view, and no chat composer, while the pane has not mounted yet', async () => {
    // Opening a project paints the cached strip before the host answers, with
    // no PTY handle yet: nothing is mounted under the overlay for a moment.
    mounted = mountTab(antigravityTab(), null)
    await mounted.settle()

    expect(mounted.screen.chatComposer).toBe(false)
    expect(mounted.screen.terminalDock).toBe(true)

    await mounted.update({ activeHandle: HANDLE, paneMounted: true })
    expect(mounted.screen).toMatchObject({ chatComposer: false, terminalPane: true, terminalDock: true })
  })

  it('degenerate: a tab whose agent identity arrives late stays a terminal, and becomes a chat only once a chat agent is named', async () => {
    mounted = mountTab(antigravityTab(null), HANDLE)
    await mounted.settle()
    expect(mounted.screen).toMatchObject({ chatComposer: false, terminalPane: true, chatToggle: false })

    // Antigravity's status lands: still a terminal, nothing flips.
    await mounted.update({ tab: antigravityTab() })
    expect(mounted.screen).toMatchObject({ chatComposer: false, terminalPane: true, terminalDock: true })

    // The same pane later reports Claude Code (the person quit `agy` and ran
    // `claude`): that is a chat agent, and it opens in Chat UI by default.
    await mounted.update({ tab: { ...antigravityTab(), launchAgent: 'claude', agentStatus: claudeStatus() } })
    expect(mounted.screen).toMatchObject({ chatComposer: true, terminalDock: false, chatToggle: true })
  })

  it('leaves the Claude tab beside it in its chat', async () => {
    mounted = mountTab(claudeTab, 'pty-claude')
    await mounted.settle()

    expect(mounted.screen).toEqual({
      chatComposer: true,
      terminalPane: false,
      terminalDock: false,
      chatToggle: true
    })
  })
})
