import { createElement, useRef, type MutableRefObject } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeAgentHudBeacons, resetAgentHudBeacons } from './agent-hud-beacon'
import { useMobileNativeChatActiveResolution } from './use-mobile-native-chat-active-resolution'
import type { MobileNativeChatTab } from './mobile-native-chat-eligibility'

// Why: this hook mounts through expo-router's focus effect and the session-view
// preference store; neither is what these cases are about.
vi.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    void effect
  }
}))

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

/** One real beacon line, in the shape `agent-hud-launch-args.ts` makes an agent
 *  write to its own PTY: OSC 7777, CUIHUD1, space-separated key=value. */
function beaconBytes(agent: string): string {
  return `${ESC}]7777;CUIHUD1 agent=${agent} model=claude-opus-5${BEL}`
}

/** A terminal tab the way the host publishes one: addressed `parentTabId::leafId`,
 *  and with no agent named — Orca launched a plain shell, so only the PTY's own
 *  beacon can say what is running in it. */
const anonymousTerminalTab: MobileNativeChatTab & { id: string } = {
  type: 'terminal',
  id: 'tab-1::leaf-1'
}

type Rendered = {
  activeChatEligible: boolean
  activeChatAgent: string | null
  streamIdentity: string
}

function mountResolution(handle: string | null) {
  let latest: Rendered | null = null
  let handleRef!: MutableRefObject<string | null>

  function Probe({ activeHandle }: { activeHandle: string | null }) {
    // The route writes this ref from subscription handlers and async callbacks,
    // then calls setActiveHandle. The probe mirrors that: the ref is advanced by
    // the test, the prop lands on the next render.
    const ref = useRef<string | null>(activeHandle)
    handleRef = ref
    const resolution = useMobileNativeChatActiveResolution({
      hostId: 'host-1',
      worktreeId: 'repo-1::/w',
      activeSessionTab: anonymousTerminalTab,
      activeSessionTabId: anonymousTerminalTab.id,
      activeHandle,
      activeHandleRef: ref,
      nativeChatTranscriptIsLocalReadable: true
    })
    latest = {
      activeChatEligible: resolution.activeChatEligible,
      activeChatAgent: resolution.activeChatAgent,
      streamIdentity: resolution.streamIdentity
    }
    return null
  }

  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(createElement(Probe, { activeHandle: handle }))
  })
  return {
    get latest(): Rendered {
      if (!latest) {
        throw new Error('probe never rendered')
      }
      return latest
    },
    get handleRef(): MutableRefObject<string | null> {
      return handleRef
    },
    setActiveHandle(next: string | null) {
      act(() => {
        handleRef.current = next
        renderer.update(createElement(Probe, { activeHandle: next }))
      })
    }
  }
}

describe('native chat resolution follows the active terminal', () => {
  beforeEach(() => {
    resetAgentHudBeacons()
  })

  it('offers Chat UI once the PTY beacon names an agent the tab never did', () => {
    const probe = mountResolution('pty-1')
    expect(probe.latest.activeChatEligible).toBe(false)

    act(() => {
      consumeAgentHudBeacons('pty-1', beaconBytes('claude'))
    })

    // Eligibility is the header's Chat/Terminal button. Whether the tab then
    // OPENS in chat is the per-tab view override, which loads asynchronously
    // and is a different question from "can this tab do chat at all".
    expect(probe.latest.activeChatEligible).toBe(true)
  })

  it('reads the beacon of the terminal the route switched to, not the one it left', () => {
    // The regression: the handle was read off a mutable ref during render, so
    // useSyncExternalStore kept a getSnapshot closed over the previous terminal.
    // Both terminals answered null, the store saw no change, and the new tab's
    // beacon never reached the header — no Chat/Terminal button, no Chat UI.
    const probe = mountResolution('pty-1')

    probe.setActiveHandle('pty-2')
    act(() => {
      consumeAgentHudBeacons('pty-2', beaconBytes('codex'))
    })

    expect(probe.latest.activeChatEligible).toBe(true)
  })

  it('ignores a beacon belonging to a terminal that is no longer active', () => {
    const probe = mountResolution('pty-1')
    act(() => {
      consumeAgentHudBeacons('pty-1', beaconBytes('claude'))
    })
    expect(probe.latest.activeChatEligible).toBe(true)

    probe.setActiveHandle('pty-2')

    expect(probe.latest.activeChatEligible).toBe(false)
  })

  it('keys the transcript stream on the terminal it rendered, not on a later ref write', () => {
    const probe = mountResolution('pty-1')
    const rendered = probe.latest.streamIdentity
    expect(rendered).toContain('pty-1')

    // A subscription handler advances the ref before React has re-rendered. The
    // identity this render published must stay the one it was computed with, or
    // the stream teardown and its resubscribe disagree about which PTY they mean.
    probe.handleRef.current = 'pty-2'

    expect(probe.latest.streamIdentity).toBe(rendered)
  })
})
