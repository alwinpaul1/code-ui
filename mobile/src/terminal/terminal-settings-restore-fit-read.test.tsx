import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Terminal settings, "When you leave the app", against the desktop's real reply. Orca answers
 * terminal.getAutoRestoreFit and terminal.setAutoRestoreFit with { ms: number | null } as the
 * envelope's `result` (src/main/runtime/rpc/methods/terminal.ts, getMobileAutoRestoreFitMs: null
 * is "keep at phone size", a finite value is clamped to the desktop's range).
 *
 * Two defects drew "Keep at phone size (default)" for a setting the phone did not know:
 *   - the screen read `ms` off the envelope, where it never is, so every desktop read as the
 *     default, and picking "After 1 minute" flipped back to the default when the desktop agreed;
 *   - a rejected read (old host, dropped connection) stored null, which is the default, and the
 *     picker preselected it.
 * An unknown setting now says so, the picker cannot be opened on it, and it is read again on the
 * next connection or on a tap, not on every status tick (review, 2026-09-30).
 */

type Entry = { hostId: string; client: unknown; state: string }

const fakes = vi.hoisted(() => ({
  entries: [] as Entry[],
  pickers: [] as Record<string, unknown>[]
}))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Animated: {},
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Smartphone: 'Smartphone',
  Type: 'Type'
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }))
vi.mock('../transport/host-store', () => ({
  loadHostCatalog: async () => [
    {
      id: 'host-1',
      credentialStatus: 'ready',
      profile: {
        id: 'host-1',
        name: 'Studio Mac',
        endpoint: 'ws://192.168.1.10:6768',
        publicKeyB64: 'key',
        lastConnected: 0
      }
    }
  ]
}))
vi.mock('../transport/settings-host-client-connections', () => ({
  useFocusedSettingsHostClients: () => ({ clients: fakes.entries, focused: true })
}))
vi.mock('../components/TerminalShortcutSettings', () => ({ TerminalShortcutSettings: () => null }))
// The drawer itself is not under test: what the screen hands it is.
vi.mock('../components/PickerModal', () => ({
  PickerModal: (props: Record<string, unknown>) => {
    fakes.pickers.push(props)
    return null
  }
}))

import TerminalSettingsScreen from '../../app/terminal-settings'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

type Reply = unknown | (() => Promise<unknown>)

function hostClient(replies: { get: Reply[]; set?: Reply[] }) {
  let connectedAt = 1000
  const sendRequest = vi.fn(async (method: string) => {
    const queue = method === 'terminal.setAutoRestoreFit' ? (replies.set ?? []) : replies.get
    const next = queue.length > 1 ? queue.shift() : queue[0]
    return typeof next === 'function' ? (next as () => Promise<unknown>)() : next
  })
  const client = {
    sendRequest,
    getLastConnectedAt: () => connectedAt,
    getState: () => 'connected'
  }
  return {
    client,
    sendRequest,
    reconnect: () => {
      connectedAt += 1000
    }
  }
}

const ok = (ms: number | null) => ({ id: 'r', ok: true, result: { ms } })
const rejected = () => Promise.reject(new Error('Connection interrupted'))
/** A failed read over a connection that is up: the row can read it again. */
const RETRY_CAPTION = "Couldn't read. Tap to retry."

let renderer: ReactTestRenderer | null = null

function screen(scheme: 'light' | 'dark') {
  return (
    <ThemeProvider initialPreference={scheme}>
      <TerminalSettingsScreen />
    </ThemeProvider>
  )
}

async function mount(scheme: 'light' | 'dark' = 'light'): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(screen(scheme))
  })
  await flush()
  return renderer!
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve()
    }
  })
}

/** A connection-state tick: the hook hands the screen a fresh list for the same clients. */
async function tick(scheme: 'light' | 'dark' = 'light'): Promise<void> {
  fakes.entries = fakes.entries.map((entry) => ({ ...entry }))
  await act(async () => {
    renderer!.update(screen(scheme))
  })
  await flush()
}

function hostRow(tree: ReactTestRenderer) {
  return tree.root.find(
    (node) =>
      String(node.type) === 'Pressable' &&
      node.findAll((child) => String(child.type) === 'Text' && child.props.children === 'Studio Mac')
        .length > 0
  )
}

function rowSublabel(tree: ReactTestRenderer): { text: string; color: unknown } {
  const texts = hostRow(tree).findAll((node) => String(node.type) === 'Text')
  const sub = texts[1]!
  const style = [sub.props.style].flat(Infinity) as Record<string, unknown>[]
  return { text: String(sub.props.children), color: Object.assign({}, ...style).color }
}

/** The latest props the restore picker (not the text-size one) was drawn with. */
function restorePicker(): Record<string, unknown> {
  const restore = fakes.pickers
    .toReversed()
    .find((props) => (props.options as { value: string }[]).some((o) => o.value === '60s'))
  if (!restore) {
    throw new Error('restore picker not drawn')
  }
  return restore
}

beforeEach(() => {
  fakes.entries = []
  fakes.pickers = []
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('Terminal settings restore-after-leaving row', () => {
  it("shows the desktop's own setting, not the default", async () => {
    const host = hostClient({ get: [ok(60_000)] })
    fakes.entries = [{ hostId: 'host-1', client: host.client, state: 'connected' }]
    const tree = await mount()

    expect(rowSublabel(tree).text).toBe('After 1 minute')
  })

  it('shows "Keep at phone size (default)" when the desktop says null', async () => {
    const host = hostClient({ get: [ok(null)] })
    fakes.entries = [{ hostId: 'host-1', client: host.client, state: 'connected' }]
    const tree = await mount()

    expect(rowSublabel(tree).text).toBe('Keep at phone size (default)')
    expect(hostRow(tree).props.disabled).toBe(false)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)(
    'says it could not read the setting, not the default, and will not open the picker, when the read is rejected (%s)',
    async (scheme, palette) => {
      const host = hostClient({ get: [rejected] })
      fakes.entries = [{ hostId: 'host-1', client: host.client, state: 'connected' }]
      const tree = await mount(scheme)

      const sub = rowSublabel(tree)
      expect(sub.text).toBe(RETRY_CAPTION)
      expect(sub.color).toBe(palette.textSecondary)
      // The tap reads again; the picker has no value to preselect.
      await act(async () => {
        hostRow(tree).props.onPress()
      })
      await flush()
      expect(restorePicker().visible).toBe(false)
    }
  )

  it('treats an error reply, and a reply with no ms, as unknown rather than the default', async () => {
    const refused = hostClient({
      get: [{ id: 'r', ok: false, error: { code: 'method_not_found', message: 'Unknown method' } }]
    })
    fakes.entries = [{ hostId: 'host-1', client: refused.client, state: 'connected' }]
    let tree = await mount()
    expect(rowSublabel(tree).text).toBe(RETRY_CAPTION)
    act(() => renderer?.unmount())

    const noMs = hostClient({ get: [{ id: 'r', ok: true, result: {} }] })
    fakes.entries = [{ hostId: 'host-1', client: noMs.client, state: 'connected' }]
    tree = await mount()
    expect(rowSublabel(tree).text).toBe(RETRY_CAPTION)
  })

  it('reads a failed setting again once per new connection, not on every status tick', async () => {
    const host = hostClient({ get: [rejected, ok(5 * 60_000)] })
    fakes.entries = [{ hostId: 'host-1', client: host.client, state: 'connected' }]
    const tree = await mount()
    expect(host.sendRequest).toHaveBeenCalledTimes(1)
    expect(rowSublabel(tree).text).toBe(RETRY_CAPTION)

    await tick()
    await tick()
    expect(host.sendRequest).toHaveBeenCalledTimes(1)
    expect(rowSublabel(tree).text).toBe(RETRY_CAPTION)

    host.reconnect()
    await tick()
    expect(host.sendRequest).toHaveBeenCalledTimes(2)
    expect(rowSublabel(tree).text).toBe('After 5 minutes')
  })

  it('does not read a desktop that is not connected yet, and reads it when it connects', async () => {
    const host = hostClient({ get: [ok(30 * 60_000)] })
    fakes.entries = [{ hostId: 'host-1', client: host.client, state: 'connecting' }]
    const tree = await mount()
    expect(host.sendRequest).not.toHaveBeenCalled()
    expect(rowSublabel(tree).text).toBe('…')
    expect(hostRow(tree).props.disabled).toBe(true)

    fakes.entries = [{ hostId: 'host-1', client: host.client, state: 'connected' }]
    await tick()
    expect(host.sendRequest).toHaveBeenCalledTimes(1)
    expect(rowSublabel(tree).text).toBe('After 30 minutes')
  })

  it('keeps the picked value when the desktop confirms it', async () => {
    const host = hostClient({ get: [ok(null)], set: [ok(60_000)] })
    fakes.entries = [{ hostId: 'host-1', client: host.client, state: 'connected' }]
    const tree = await mount()
    await act(async () => {
      hostRow(tree).props.onPress()
    })
    const picker = restorePicker()
    expect(picker.visible).toBe(true)
    expect(picker.selected).toBe('indefinite')

    await act(async () => {
      ;(picker.onSelect as (value: string) => void)('60s')
    })
    await flush()

    expect(host.sendRequest).toHaveBeenCalledWith('terminal.setAutoRestoreFit', { ms: 60_000 })
    expect(rowSublabel(tree).text).toBe('After 1 minute')
  })

  it('reads back what the desktop has when the write fails, and says unknown if that fails too', async () => {
    const host = hostClient({ get: [ok(null), rejected], set: [rejected] })
    fakes.entries = [{ hostId: 'host-1', client: host.client, state: 'connected' }]
    const tree = await mount()
    await act(async () => {
      hostRow(tree).props.onPress()
    })
    await act(async () => {
      ;(restorePicker().onSelect as (value: string) => void)('5m')
    })
    await flush()

    expect(host.sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'terminal.getAutoRestoreFit',
      'terminal.setAutoRestoreFit',
      'terminal.getAutoRestoreFit'
    ])
    // Neither the optimistic "After 5 minutes" nor the default: the phone does not know.
    expect(rowSublabel(tree).text).toBe(RETRY_CAPTION)
  })
})

/**
 * A read that fails on a connection that stays up. The setting is read once per connection, so
 * nothing reads it again until the relay reconnects, and the row used to be disabled: "Couldn't
 * read" with no way out on a healthy connection (review, 2026-09-30). The stale-after-reconnect
 * rule keeps a manual retry for exactly this case, so a tap reads it again, once.
 */
describe('Terminal settings restore-after-leaving row after a failed read', () => {
  function deferred(): { reply: () => Promise<unknown>; resolve: (value: unknown) => void } {
    let resolve: (value: unknown) => void = () => {}
    const promise = new Promise<unknown>((settle) => {
      resolve = settle
    })
    return { reply: () => promise, resolve }
  }

  async function press(tree: ReactTestRenderer): Promise<void> {
    await act(async () => {
      hostRow(tree).props.onPress()
    })
    await flush()
  }

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)(
    'lets a tap read a failed setting again on a healthy connection, then opens the picker on it (%s)',
    async (scheme, palette) => {
      const retry = deferred()
      const host = hostClient({ get: [rejected, retry.reply] })
      fakes.entries = [{ hostId: 'host-1', client: host.client, state: 'connected' }]
      const tree = await mount(scheme)
      expect(rowSublabel(tree)).toEqual({ text: RETRY_CAPTION, color: palette.textSecondary })
      expect(hostRow(tree).props.disabled).toBe(false)

      await press(tree)
      expect(host.sendRequest).toHaveBeenCalledTimes(2)
      // Reading: neither the failure nor a value, and no second tap until it answers.
      expect(rowSublabel(tree).text).toBe('…')
      expect(hostRow(tree).props.disabled).toBe(true)
      expect(restorePicker().visible).toBe(false)

      await act(async () => {
        retry.resolve(ok(60_000))
      })
      await flush()
      expect(rowSublabel(tree).text).toBe('After 1 minute')
      expect(restorePicker().visible).toBe(false)

      await press(tree)
      expect(restorePicker().visible).toBe(true)
      expect(restorePicker().selected).toBe('60s')
      expect(host.sendRequest).toHaveBeenCalledTimes(2)
    }
  )

  it('keeps the row retryable when a pick fails and reading it back fails too', async () => {
    const host = hostClient({ get: [ok(null), rejected, ok(5 * 60_000)], set: [rejected] })
    fakes.entries = [{ hostId: 'host-1', client: host.client, state: 'connected' }]
    const tree = await mount()
    await press(tree)
    await act(async () => {
      ;(restorePicker().onSelect as (value: string) => void)('5m')
    })
    await flush()
    expect(rowSublabel(tree).text).toBe(RETRY_CAPTION)
    expect(hostRow(tree).props.disabled).toBe(false)
    expect(restorePicker().visible).toBe(false)

    await press(tree)
    expect(host.sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'terminal.getAutoRestoreFit',
      'terminal.setAutoRestoreFit',
      'terminal.getAutoRestoreFit',
      'terminal.getAutoRestoreFit'
    ])
    expect(rowSublabel(tree).text).toBe('After 5 minutes')
    expect(restorePicker().visible).toBe(false)
  })

  it('stays retryable when the retry fails too, and reads only when tapped', async () => {
    const host = hostClient({ get: [rejected, rejected, ok(30 * 60_000)] })
    fakes.entries = [{ hostId: 'host-1', client: host.client, state: 'connected' }]
    const tree = await mount()

    await press(tree)
    expect(host.sendRequest).toHaveBeenCalledTimes(2)
    expect(rowSublabel(tree).text).toBe(RETRY_CAPTION)
    expect(hostRow(tree).props.disabled).toBe(false)
    expect(restorePicker().visible).toBe(false)

    await tick()
    await tick()
    expect(host.sendRequest).toHaveBeenCalledTimes(2)

    await press(tree)
    expect(host.sendRequest).toHaveBeenCalledTimes(3)
    expect(rowSublabel(tree).text).toBe('After 30 minutes')
  })

  it('reads once for two taps that land before the row redraws', async () => {
    const host = hostClient({ get: [rejected, ok(60_000)] })
    fakes.entries = [{ hostId: 'host-1', client: host.client, state: 'connected' }]
    const tree = await mount()

    const onPress = hostRow(tree).props.onPress as () => void
    await act(async () => {
      onPress()
      onPress()
    })
    await flush()
    expect(host.sendRequest).toHaveBeenCalledTimes(2)
    expect(rowSublabel(tree).text).toBe('After 1 minute')
  })

  it('offers no retry for a desktop that is not connected', async () => {
    const host = hostClient({ get: [rejected, ok(60_000)] })
    fakes.entries = [{ hostId: 'host-1', client: host.client, state: 'connected' }]
    const tree = await mount()
    fakes.entries = [{ hostId: 'host-1', client: host.client, state: 'reconnecting' }]
    await tick()

    expect(rowSublabel(tree).text).toBe("Couldn't read")
    expect(hostRow(tree).props.disabled).toBe(true)
    // A press that got through anyway still reads nothing over a connection that is down.
    await act(async () => {
      ;(hostRow(tree).props.onPress as (() => void) | undefined)?.()
    })
    await flush()
    expect(host.sendRequest).toHaveBeenCalledTimes(1)
    expect(restorePicker().visible).toBe(false)
  })
})
