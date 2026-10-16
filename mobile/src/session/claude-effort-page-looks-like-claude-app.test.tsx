/**
 * 2026-10-16, from the device beside the Claude app (1.261013.20): "the effort picker … I need
 * this exactly like claude, same colors like claude mobile". The app's Effort page has a grey
 * "Recommended" pill on Medium, an amber "4× or more usage" pill on Max, its check in blue, and
 * "Higher effort means more thorough responses, but takes longer and uses your limits faster."
 * under the list. Those three texts are Anthropic's server data (`thinking.effort_options[].badge`,
 * `thinking.description`; yyy.java:19-23, azy.java:19-21), so they are copied from the user's screen.
 * Badge: w8m.java:11-46, fully round, 8/2 dp padding, 11 sp. Check: `C0()`, #184F95 / #6DA7EC.
 */
import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionOptionDescriptor } from '../../../src/shared/native-chat-session-options'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { ThemeProvider } from '../theme/theme-context'
import { claudePickerPalette } from '../theme/claude-picker-palette'
import type { CcrModelReading } from './ccr-session-model'
import { resetClaudeDiscoveryForTests } from './claude-model-discovery'
import type { ClaudeModelFallback } from './claude-transcript-model'
import { MobileNativeChatSessionOptionPickers } from './MobileNativeChatSessionOptionPickers'
import { useMobileNativeChatSessionOptionController } from './use-mobile-native-chat-session-option-controller'
import { resetMobileNativeChatSessionOptionRecordsForTests } from './use-mobile-native-chat-session-options'

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
let beaconAt: number | null = null
let transcriptModel: ClaudeModelFallback = { kind: 'none' }
let live: { model: string | null; label: string | null; effort: string | null } = { model: null, label: null, effort: null }

function Chat(): ReactElement | null {
  const { nativeChatSessionOptions } = useMobileNativeChatSessionOptionController({
    activeChatStructured: false,
    activeSessionTabId: 'tab-work',
    agent: 'claude',
    dispatchCommand: async () => 'rejected',
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
    onFailure: noop
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

function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...([style].flat(Infinity) as Array<Record<string, unknown> | null>).filter(Boolean))
}

async function openEffortPage(): Promise<void> {
  await openSheet()
  const row = renderer!.root.find(
    (node) => (node.type as unknown) === 'Pressable' && typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith('Effort')
  )
  await act(async () => {
    row.props.onPress()
  })
}

/** The pill a badge's words sit in: the nearest View above them. */
function pillOf(node: ReactTestInstance): ReactTestInstance {
  let at = node.parent
  while (at && (at.type as unknown) !== 'View') {
    at = at.parent
  }
  return at!
}

const textNode = (text: string): ReactTestInstance =>
  renderer!.root.find((node) => (node.type as unknown) === 'Text' && node.props.children === text)

describe('the Effort page of a Claude tab', () => {
  beforeEach(() => {
    resetMobileNativeChatSessionOptionRecordsForTests()
    resetClaudeDiscoveryForTests()
    ccrModel = null
    transcriptModel = { kind: 'none' }
    live = { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium' }
    beaconAt = 5
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  for (const scheme of ['light', 'dark'] as const) {
    const colors = claudePickerPalette(scheme)
    it(`has the app's badges, blue check and caption (${scheme})`, async () => {
      await mount(scheme)
      await openEffortPage()
      const page = words(renderer!.root)
      expect(page).toContain('Recommended')
      expect(page).toContain('4× or more usage')
      expect(page).toContain('Higher effort means more thorough responses, but takes longer and uses your limits faster.')
      // Medium carries the grey pill, Max the amber one.
      expect(page.indexOf('Recommended')).toBe(page.indexOf('Medium') + 1)
      expect(page.indexOf('4× or more usage')).toBe(page.indexOf('Max') + 1)
      expect(flat(textNode('Recommended').props.style).color).toBe(colors.badgeNeutralText)
      expect(flat(pillOf(textNode('Recommended')).props.style).backgroundColor).toBe(colors.badgeNeutralFill)
      expect(flat(textNode('4× or more usage').props.style).color).toBe(colors.badgeWarningText)
      expect(flat(pillOf(textNode('4× or more usage')).props.style).backgroundColor).toBe(colors.badgeWarningFill)
      const checks = renderer!.root.findAll((node) => (node.type as unknown) === 'Check')
      expect(checks).toHaveLength(1)
      expect(checks[0]!.props.color).toBe(colors.check)
    })
  }

  it('uses the app’s values: blue check, grey and amber pills', () => {
    const [light, dark] = [claudePickerPalette('light'), claudePickerPalette('dark')]
    expect([light.check, dark.check]).toEqual(['#184F95', '#6DA7EC'])
    expect([light.badgeWarningText, dark.badgeWarningText]).toEqual(['#A66A00', '#B77700'])
    expect([light.badgeNeutralText, dark.badgeNeutralText]).toEqual(['#52514E', '#C3C2B7'])
  })

  it('checks the model sheet’s running model in the same blue', async () => {
    await mount('dark')
    await openSheet()
    const checks = renderer!.root.findAll((node) => (node.type as unknown) === 'Check')
    expect(checks.map((check) => check.props.color)).toEqual([claudePickerPalette('dark').check])
  })
})
