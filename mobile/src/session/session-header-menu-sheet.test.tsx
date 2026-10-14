import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The header's "…" menu gains the Claude app's session entries (com.anthropic.claude 1.261009.20,
 * `us8` ~L282-357; parity gap G35): Copy branch, Background tasks, Rename, and Copy session ID,
 * each only where Orca's RPC already gives the phone what it needs.
 */

const sheetProps = vi.hoisted(
  () =>
    [] as {
      actions: { label: string; onPress: () => void; closeBeforePress?: boolean; destructive?: boolean }[]
      message?: string
      messageTone?: string
    }[]
)
vi.mock('../components/ActionSheetModal', () => ({
  ActionSheetModal: (props: (typeof sheetProps)[number]) => {
    sheetProps.push(props)
    return null
  }
}))
vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})
vi.mock('../agent-history/MobileAgentSessionHistoryIcon', () => ({ MobileAgentSessionHistoryIcon: () => null }))
vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  useColorScheme: () => 'light'
}))

import { ThemeProvider } from '../theme/theme-context'
import { MobileSessionHeaderMoreActionsSheet } from './MobileSessionHeaderMoreActionsSheet'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  sheetProps.length = 0
})

function handlers() {
  return {
    onOpenAgentSessionHistory: vi.fn(),
    onOpenChecks: vi.fn(),
    onOpenMcpServers: vi.fn(),
    onOpenPermissionRules: vi.fn(),
    onOpenProjectMemory: vi.fn(),
    onCopyBranch: vi.fn(),
    onOpenBackgroundTasks: vi.fn(),
    onChangeModel: vi.fn(),
    onRename: vi.fn(),
    onArchive: vi.fn(),
    onCopySessionId: vi.fn(),
    onCheckSessionImages: vi.fn(),
    onClose: vi.fn()
  }
}

type Entry = 'copy-branch' | 'background-tasks' | 'change-model' | 'rename' | 'archive' | 'copy-session-id'
const EVERY_ENTRY: Entry[] = ['copy-branch', 'background-tasks', 'change-model', 'rename', 'archive', 'copy-session-id']

function mount(
  scheme: 'light' | 'dark',
  session: { entries: Entry[]; connection?: { text: string; connected: boolean } },
  calls = handlers()
) {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        {createElement(MobileSessionHeaderMoreActionsSheet, {
          visible: true,
          showAgentSessionHistory: true,
          showChecks: false,
          showProjectConfigActions: true,
          sessionEntries: session.entries,
          connection: session.connection,
          ...calls
        })}
      </ThemeProvider>
    )
  })
  return calls
}

const labels = () => sheetProps.at(-1)!.actions.map((action) => action.label)
const action = (label: string) => sheetProps.at(-1)!.actions.find((entry) => entry.label === label)!

describe.each(['light', 'dark'] as const)('the session menu in %s mode', (scheme) => {
  it("lists Claude's session entries first, in Claude's order, and Copy session ID last", () => {
    mount(scheme, { entries: EVERY_ENTRY })
    expect(labels()).toEqual([
      'Copy branch',
      'Background tasks',
      'Change model',
      'Rename',
      'Archive',
      'Agent History',
      'MCP Servers',
      'Permission Rules',
      'Project Memory',
      'Check session images',
      'Copy session ID'
    ])
  })

  it('leaves out the entries the session cannot offer', () => {
    mount(scheme, { entries: ['rename'] })
    expect(labels()).toEqual(['Rename', 'Agent History', 'MCP Servers', 'Permission Rules', 'Project Memory', 'Check session images'])
  })

  it('hands each entry to its own handler', () => {
    const calls = mount(scheme, { entries: EVERY_ENTRY })
    action('Copy branch').onPress()
    action('Background tasks').onPress()
    action('Change model').onPress()
    action('Rename').onPress()
    action('Archive').onPress()
    action('Copy session ID').onPress()
    action('Check session images').onPress()
    expect(calls.onCheckSessionImages).toHaveBeenCalledTimes(1)
    expect(calls.onCopyBranch).toHaveBeenCalledTimes(1)
    expect(calls.onOpenBackgroundTasks).toHaveBeenCalledTimes(1)
    expect(calls.onChangeModel).toHaveBeenCalledTimes(1)
    expect(calls.onRename).toHaveBeenCalledTimes(1)
    expect(calls.onArchive).toHaveBeenCalledTimes(1)
    expect(calls.onCopySessionId).toHaveBeenCalledTimes(1)
  })

  it('waits for the menu to close before a sheet or dialog opens over it', () => {
    // The dual-Modal race (#10331): a second sheet opened while this one is still up. Change
    // model opens the model sheet and Archive its confirmation, so both wait as well.
    mount(scheme, { entries: ['background-tasks', 'change-model', 'rename', 'archive'] })
    expect(action('Background tasks').closeBeforePress).toBe(true)
    expect(action('Change model').closeBeforePress).toBe(true)
    expect(action('Rename').closeBeforePress).toBe(true)
    expect(action('Archive').closeBeforePress).toBe(true)
    expect(action('Check session images').closeBeforePress).toBe(true)
  })

  it('marks Archive as the one entry that ends the session', () => {
    mount(scheme, { entries: EVERY_ENTRY })
    expect(action('Archive').destructive).toBe(true)
    expect(action('Rename').destructive).toBeFalsy()
  })

  it('says Connected in the success tone, and Disconnected beside its reconnect hint in a quiet one', () => {
    mount(scheme, { entries: ['rename'], connection: { text: 'Connected', connected: true } })
    expect(sheetProps.at(-1)).toMatchObject({ message: 'Connected', messageTone: 'success' })
    mount(scheme, {
      entries: ['rename'],
      connection: { text: 'Disconnected • Reconnect from Alwin’s Mac', connected: false }
    })
    expect(sheetProps.at(-1)).toMatchObject({
      message: 'Disconnected • Reconnect from Alwin’s Mac',
      messageTone: 'muted'
    })
  })

  it('draws no connection line when none is given', () => {
    mount(scheme, { entries: ['rename'] })
    expect(sheetProps.at(-1)?.message).toBeUndefined()
  })
})
