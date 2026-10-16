/**
 * Reported 2026-10-16 from the device (0.9.154): a work-profile Claude tab with no beacon opened
 * its model sheet on Fable / Opus / Sonnet / Haiku and "More models", with no Effort row under
 * them, while the pill above read "Opus 5.5 Medium" and the Claude app's sheet for the same
 * session has "Effort  Medium >". The pill reads the session's report to Anthropic and the
 * transcript scan as fallbacks (preferCcrModelPair, claudeModelPillPair); the options hook was
 * handed only the beacon's pair, so with no beacon it knew no running model and no effort levels.
 */
import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionOptionDescriptor } from '../../../src/shared/native-chat-session-options'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { ThemeProvider } from '../theme/theme-context'
import type { CcrModelReading } from './ccr-session-model'
import { resetClaudeDiscoveryForTests } from './claude-model-discovery'
import type { ClaudeModelFallback } from './claude-transcript-model'
import { MobileNativeChatSessionOptionPickers } from './MobileNativeChatSessionOptionPickers'
import { useMobileNativeChatSessionOptionController } from './use-mobile-native-chat-session-option-controller'
import { resetMobileNativeChatSessionOptionRecordsForTests } from './use-mobile-native-chat-session-options'
import { EFFORT_PICK_CONFIRM_MS } from './native-chat-effort-pick'
import { setSheetFailureClockForTests } from './use-sheet-failure'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Keyboard: { dismiss: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ArrowLeft: 'ArrowLeft',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  X: 'X'
}))
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
      visible ? React.createElement('BottomDrawer', { visible }, children) : null
  }
})
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => 1
}))

/** What the phone logged for the tab at 08:38:39 (masked id unmasked to the observed shape). */
const READING: CcrModelReading = {
  sessionId: 'cse_019B3GJ144LCrvsuFFkN8U6U',
  epoch: 1,
  model: 'claude-opus-5-5',
  effort: 'medium',
  fetchedAt: 1
}

const client = {
  sendRequest: async (): Promise<RpcResponse> => ({
    id: 'rpc',
    ok: false,
    error: { code: 'unavailable', message: 'not answered by this suite' }
  }),
  getState: () => 'connected',
  notifyForeground: () => undefined
} as unknown as RpcClient
const noop = (): void => undefined
const structured = {
  snapshot: [] as SessionOptionDescriptor[],
  pendingId: null,
  setOption: async () => false,
  invokeAction: async () => false
}

let ccrModel: CcrModelReading | null = READING
let dispatchOutcome: 'accepted' | 'rejected' = 'rejected'
const failures: string[] = []
let beaconAt: number | null = null
let transcriptModel: ClaudeModelFallback = { kind: 'none' }
let live: { model: string | null; label: string | null; effort: string | null } = { model: null, label: null, effort: null }

function Chat(): ReactElement | null {
  const { nativeChatSessionOptions } = useMobileNativeChatSessionOptionController({
    activeChatStructured: false,
    activeSessionTabId: 'tab-work',
    agent: 'claude',
    dispatchCommand: async () => dispatchOutcome,
    hostId: 'host-mac',
    isTabChatView: () => true,
    isWorking: false,
    reportedModel: live.model,
    reportedModelLabel: live.label,
    reportedEffort: live.effort,
    reportedModelSource: live.model ? 'live' : 'launch',
    // No terminal attached: the composer reads "Waiting for terminal…".
    terminalHandle: null,
    transcriptModel,
    ccrModel,
    beaconAt,
    structured,
    toggleTabChatView: noop,
    worktreeId: 'repo-1::/Users/alwinpaul/Desktop/NexOS-Mobile-wt/tablet-cab-redesign',
    client,
    handleRef: { current: null },
    deviceTokenRef: { current: 'device' },
    refreshHud: async () => undefined,
    onFailure: (message: string) => failures.push(message)
  })
  return nativeChatSessionOptions
    ? createElement(MobileNativeChatSessionOptionPickers, nativeChatSessionOptions)
    : null
}

let renderer: ReactTestRenderer | null = null

async function mount(scheme: 'light' | 'dark' = 'light'): Promise<void> {
  await act(async () => {
    renderer = create(<ThemeProvider initialPreference={scheme}>{createElement(Chat)}</ThemeProvider>)
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function modelPill(): ReactTestInstance {
  return renderer!.root.find(
    (node) =>
      (node.type as unknown) === 'Pressable' &&
      typeof node.props.accessibilityLabel === 'string' &&
      node.props.accessibilityLabel.startsWith('Model, ')
  )
}

function words(node: ReactTestInstance | string, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  node.children.forEach((child) => words(child, out))
  return out
}

async function openSheet(): Promise<string[]> {
  await act(async () => {
    modelPill().props.onPress()
  })
  return words(renderer!.root)
}

describe('the model sheet of a Claude tab with no beacon', () => {
  beforeEach(() => {
    resetMobileNativeChatSessionOptionRecordsForTests()
    resetClaudeDiscoveryForTests()
    ccrModel = null
    beaconAt = null
    transcriptModel = { kind: 'none' }
    live = { model: null, label: null, effort: null }
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  for (const scheme of ['light', 'dark'] as const) {
    it(`has the Effort row when only Anthropic's copy of the session names the model (${scheme})`, async () => {
      ccrModel = READING
      await mount(scheme)
      const sheet = await openSheet()
      expect(sheet).toContain('Effort')
      expect(sheet[sheet.indexOf('Effort') + 1]).toBe('Medium')
    })
  }

  it('has the Effort row when only the transcript names the model', async () => {
    transcriptModel = { kind: 'transcript', model: { model: 'claude-opus-5-5', label: 'Opus 5.5' }, effort: 'high' }
    await mount()
    const sheet = await openSheet()
    expect(sheet).toContain('Effort')
    expect(sheet[sheet.indexOf('Effort') + 1]).toBe('High')
  })

  it('still has it from the beacon, which outranks both', async () => {
    ccrModel = { ...READING, effort: 'low' }
    live = { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'max' }
    beaconAt = 5
    await mount()
    const sheet = await openSheet()
    expect(sheet[sheet.indexOf('Effort') + 1]).toBe('Max')
  })

  it('draws no Effort row with no reading at all, rather than inventing a model', async () => {
    await mount()
    expect(await openSheet()).not.toContain('Effort')
  })
})

// Review of the change above, 2026-10-16: Anthropic's copy of the session is read once a minute and
// the read-back after a pick re-reads only the screen, so judging a pick against it called an effort
// Claude took "not taken" after 10 s ("Effort is still Medium: the agent did not take High"). The
// sheet runs on that reading; a pick is judged only against what the agent itself says.
describe('an effort pick on a Claude tab with no beacon', () => {
  beforeEach(() => {
    let clock = 0
    setSheetFailureClockForTests(() => (clock += 2_000))
    resetMobileNativeChatSessionOptionRecordsForTests()
    resetClaudeDiscoveryForTests()
    ccrModel = READING
    beaconAt = null
    transcriptModel = { kind: 'none' }
    live = { model: null, label: null, effort: null }
    dispatchOutcome = 'accepted'
    failures.length = 0
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    setSheetFailureClockForTests(null)
    vi.useRealTimers()
    dispatchOutcome = 'rejected'
  })

  it('is not called refused while Anthropic’s minute-old reading still says Medium', async () => {
    await mount()
    vi.useFakeTimers()
    await openSheet()
    const press = async (node: ReactTestInstance): Promise<void> => {
      await act(async () => {
        node.props.onPress()
        await Promise.resolve()
      })
    }
    await press(renderer!.root.find((n) => (n.type as unknown) === 'Pressable' && String(n.props.accessibilityLabel).startsWith('Effort')))
    const high = renderer!.root
      .findAll((n) => (n.type as unknown) === 'Pressable' && n.props.accessibilityRole === 'radio')
      .find((row) => words(row).includes('High'))!
    await press(high)
    await act(async () => {
      vi.advanceTimersByTime(EFFORT_PICK_CONFIRM_MS * 2)
      await Promise.resolve()
    })
    expect(failures.filter((message) => message.includes('did not take'))).toEqual([])
  })
})
