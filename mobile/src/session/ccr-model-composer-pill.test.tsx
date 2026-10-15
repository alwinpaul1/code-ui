/**
 * Reported 2026-10-15 08:40 on 0.9.150: two work-profile Claude tabs ("Tablet cab rede…" and
 * "Pull through filt…", CLAUDE_CONFIG_DIR=~/.claude-work, one composer reading "Waiting for
 * terminal…") showed the composer's model pill as the placeholder "Model". The Claude app showed
 * both sessions as "Opus 5.5 Medium", and the phone's own log had already read exactly that from
 * Anthropic's copy of the session:
 *
 *   [ccr-images] match: ok — NexDash: session cse…U6U (28) shares 21 messages with this tab
 *   [ccr-images] model: ok — model claude-opus-5-5, effort medium
 *
 * The reading reached only the header's pair (`nativeChatLiveModel`), which nothing draws. The
 * composer pill read the beacon, the badge and the transcript scan, and none of those states a
 * model on a tab with no beacon whose transcript the host's scan does not list. So the pill must
 * take the session's reported pair as one of its sources, named the way the Claude app names it.
 */
import { createElement, type ReactElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionOptionDescriptor } from '../../../src/shared/native-chat-session-options'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
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

function pillWords(): string {
  const words: string[] = []
  const walk = (node: ReactTestInstance | string): void => {
    if (typeof node === 'string') {
      words.push(node)
      return
    }
    node.children.forEach(walk)
  }
  walk(modelPill())
  return words.join('').replace(/\s+/g, ' ').trim()
}

function lastColour(style: unknown): string | undefined {
  let colour: string | undefined
  for (const entry of [style].flat(Infinity) as Array<Record<string, unknown> | null | undefined>) {
    const value = entry?.color ?? entry?.backgroundColor
    if (typeof value === 'string') {
      colour = value
    }
  }
  return colour
}

describe('the composer model pill of a work tab with no beacon, matched to its Remote Control session', () => {
  beforeEach(() => {
    resetMobileNativeChatSessionOptionRecordsForTests()
    resetClaudeDiscoveryForTests()
    ccrModel = READING
    beaconAt = null
    transcriptModel = { kind: 'none' }
    live = { model: null, label: null, effort: null }
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('reads "Opus 5.5 Medium" as the Claude app does, not "Model", in %s', async (scheme, palette) => {
    await mount(scheme)
    expect(modelPill().props.accessibilityLabel).toBe('Model, Opus 5.5 Medium')
    expect(pillWords()).toBe('Opus 5.5 Medium')
    const surface = modelPill().props.style as (state: { pressed: boolean }) => unknown
    expect(lastColour(surface({ pressed: false }))).toBe(palette.composerPill)
  })

  it('names the model without its context suffix', async () => {
    ccrModel = { ...READING, model: 'claude-opus-5-5[1m]', effort: 'xhigh' }
    await mount()
    expect(modelPill().props.accessibilityLabel).toBe('Model, Opus 5.5 Extra')
  })

  it('outranks the transcript scan’s older reading, which states no effort', async () => {
    transcriptModel = { kind: 'transcript', model: { model: 'claude-sonnet-5', label: 'Sonnet 5' } }
    await mount()
    expect(modelPill().props.accessibilityLabel).toBe('Model, Opus 5.5 Medium')
  })

  it('yields to the beacon’s live pair', async () => {
    live = { model: 'claude-fable-5-1', label: 'Fable 5.1', effort: 'high' }
    beaconAt = 5
    await mount()
    expect(modelPill().props.accessibilityLabel).toBe('Model, Fable 5.1 High')
  })

  it('still reads "Model" with no reading at all, rather than inventing one', async () => {
    ccrModel = null
    await mount()
    expect(pillWords()).toBe('Model')
  })
})

describe('the chat controller wiring', () => {
  // A defect of structure (CLAUDE.md, rule 6): the reading existed and the hook that feeds the
  // composer was never handed it. Read from code lines only, not the comments above them.
  it('hands the session’s reported pair to the composer’s option controller', () => {
    const source = readFileSync(join(import.meta.dirname, 'use-mobile-native-chat-controller.ts'), 'utf8')
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    const call = code.slice(code.indexOf('useMobileNativeChatSessionOptionController({'))
    const args = call.slice(0, call.indexOf('\n    })'))
    expect(args).toMatch(/\bccrModel: [^,\n]*ccrModel\b/)
    expect(args).toMatch(/\bbeaconAt: hudLiveBeacon\?\.receivedAt \?\? null\b/)
  })
})
