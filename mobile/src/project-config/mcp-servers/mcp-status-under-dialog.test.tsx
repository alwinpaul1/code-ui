import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../../transport/rpc-client'

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
  TextInput: 'TextInput',
  useColorScheme: () => 'light',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default }
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'View' }))
vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  Plus: 'Plus',
  Terminal: 'Terminal',
  Trash2: 'Trash2'
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn(), canGoBack: () => false, replace: vi.fn() }) }))
vi.mock('../../components/BottomDrawer', () => ({ BottomDrawer: 'View' }))

const fakes = vi.hoisted(() => ({
  client: null as RpcClient | null,
  filesWrite: 'allowed' as 'allowed' | 'forbidden'
}))
vi.mock('../../transport/client-context', () => ({
  useHostClient: () => ({ client: fakes.client, clientId: 'c1', state: 'connected' })
}))
vi.mock('../../transport/host-mobile-capabilities', () => ({
  useHostMobileCapabilityVerdict: (_hostId: string, key: string) =>
    key === 'files.write' ? fakes.filesWrite : 'unknown'
}))

import { MobileMcpServersPanel } from './MobileMcpServersPanel'
import { MCP_STATUS_NOT_SENT } from './mcp-status-overlay'
import { SEND_UNDER_DIALOG_REFUSAL } from '../../session/mobile-native-chat-dialog-guard'
import { ThemeProvider } from '../../theme/theme-context'
import { darkColors, lightColors } from '../../theme/tokens'

const MARKER = /^=== screen: (.*) ===$/

/** A capture under session/fixtures: the screen after its `=== screen: <name> ===`
 *  line (the first one when unnamed), or a marker-less file's rows after its
 *  `# ` header. */
function readScreen(file: string, name?: string): string[] {
  const text = readFileSync(fileURLToPath(new URL(`../../session/fixtures/${file}`, import.meta.url)), 'utf8')
  const rows = text.split('\n')
  const from = rows.findIndex((row) => MARKER.exec(row) !== null && (name === undefined || MARKER.exec(row)![1] === name))
  if (from === -1) {
    if (name !== undefined) {
      throw new Error(`${file} has no screen named ${name}`)
    }
    return rows.filter((row) => !row.startsWith('# '))
  }
  const to = rows.findIndex((row, at) => at > from && MARKER.test(row))
  return rows.slice(from + 1, to === -1 ? undefined : to)
}

// Claude Code 2.1.283, 2026-09-27: a subagent's Bash prompt with "Yes"
// highlighted, the prompt that sat unanswered for eight hours. `/mcp` typed
// into it is keys for the prompt, and its Enter approves the command.
// (Transcribed from the user's screenshot, not a tmux capture: the fixture's
// header lists the bytes it cannot vouch for.)
const PERMISSION_PROMPT_283 = readScreen('claude-screen-subagent-bash-permission-2.1.283.txt')
// Claude Code 2.1.282, `tmux capture-pane -p`: an AskUserQuestion menu with
// option 1 highlighted, whose Enter picks it.
const QUESTION_MENU_282 = readScreen('claude-screen-ask-single-select-2.1.282.txt', 'ask')
// Claude Code 2.1.281, `tmux capture-pane -p`: idle, nothing asking, and its
// `❯` input row (a no-break space after the glyph) at the bottom.
const IDLE_281 = readScreen('claude-screen-sent-photos-2.1.281.txt')

const ONE_SERVER = JSON.stringify({ mcpServers: { local: { command: 'npx' } } })

type Call = { method: string; params: Record<string, unknown> }

/** A connected host with one Claude tab, idle unless `tabState` says otherwise
 *  (only an idle one gets the button), answering a screen read with `screen`
 *  and a write with `accepted`. */
function host(screen: () => string[] | Promise<string[]>, accepted = true, tabState = 'done') {
  const calls: Call[] = []
  const sendRequest = vi.fn(async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params })
    if (method === 'session.tabs.list') {
      return {
        ok: true,
        result: {
          tabs: [{ type: 'terminal', id: 'tab-1', terminal: 'term-1', agentStatus: { agentType: 'claude', state: tabState } }]
        }
      }
    }
    if (method === 'files.read') {
      return { ok: true, result: { content: ONE_SERVER, truncated: false, byteLength: ONE_SERVER.length } }
    }
    if (method === 'terminal.read') {
      return { ok: true, result: { terminal: { lines: await screen(), source: 'screen' } } }
    }
    if (method === 'terminal.send') {
      return { ok: true, result: { send: { handle: 'term-1', accepted, bytesWritten: 4 } } }
    }
    return { ok: true, result: {} }
  })
  const client = { getState: () => 'connected', notifyForeground: vi.fn(), sendRequest } as unknown as RpcClient
  return {
    client,
    terminalCalls: () => calls.filter((call) => call.method.startsWith('terminal.')).map((call) => call.method),
    reads: () => calls.filter((call) => call.method === 'terminal.read').map((call) => call.params),
    writes: () => calls.filter((call) => call.method === 'terminal.send').map((call) => call.params)
  }
}

function panel(scheme: 'light' | 'dark') {
  return (
    <ThemeProvider initialPreference={scheme}>
      <MobileMcpServersPanel hostId="h1" worktreeId="w1" name="my-repo" />
    </ThemeProvider>
  )
}

/** Lets the tap's screen read, its write and the state they set all land. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

let renderer: ReactTestRenderer | null = null

async function render(client: RpcClient, scheme: 'light' | 'dark' = 'light'): Promise<ReactTestRenderer> {
  fakes.client = client
  await act(async () => {
    renderer = create(panel(scheme))
    await settle()
  })
  return renderer!
}

function showStatusButtons(tree: ReactTestRenderer): ReactTestInstance[] {
  return tree.root.findAll(
    (node) => node.props?.accessibilityRole === 'button' && node.props.accessibilityLabel === 'Show status'
  )
}

function showStatusButton(tree: ReactTestRenderer): ReactTestInstance {
  const [button] = showStatusButtons(tree)
  if (!button) {
    throw new Error('the Show status button is not drawn')
  }
  return button
}

async function tapShowStatus(tree: ReactTestRenderer): Promise<void> {
  await act(async () => {
    showStatusButton(tree).props.onPress()
    await settle()
  })
}

function captions(tree: ReactTestRenderer, text: string): ReactTestInstance[] {
  return tree.root.findAllByType('Text' as never).filter((node) => node.props.children === text)
}

function colorOf(node: ReactTestInstance): unknown {
  const style: unknown = node.props.style
  const entries = (Array.isArray(style) ? style.flat(Infinity) : [style]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...entries).color
}

beforeEach(() => {
  fakes.filesWrite = 'allowed'
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  fakes.client = null
})

// The button's own gate is one lookup of the hook status, taken when the
// screen opened. The status can miss a prompt (a subagent's, 2026-09-27), and
// the screen can sit open while one comes up. So the tap looks at the screen.
describe('the MCP screen’s Show status button while a prompt waits', () => {
  it.each([
    ['a 2.1.283 permission prompt', PERMISSION_PROMPT_283, 'allowed'],
    ['a 2.1.283 permission prompt, on a host that refuses files.write', PERMISSION_PROMPT_283, 'forbidden'],
    ['a 2.1.282 question menu', QUESTION_MENU_282, 'allowed']
  ] as const)('does not type /mcp into a terminal that is showing %s, and says why', async (_name, lines, filesWrite) => {
    fakes.filesWrite = filesWrite
    const tab = host(() => [...lines])
    const tree = await render(tab.client)
    await tapShowStatus(tree)
    expect(tab.writes()).toEqual([])
    expect(captions(tree, SEND_UNDER_DIALOG_REFUSAL)).toHaveLength(1)
  })

  it.each([
    ['light', lightColors.danger],
    ['dark', darkColors.danger]
  ] as const)('draws the refusal in the %s theme’s danger colour', async (scheme, danger) => {
    const tab = host(() => [...PERMISSION_PROMPT_283])
    const tree = await render(tab.client, scheme)
    await tapShowStatus(tree)
    const [caption] = captions(tree, SEND_UNDER_DIALOG_REFUSAL)
    expect(caption).toBeDefined()
    expect(colorOf(caption!)).toBe(danger)
  })

  it('looks at the screen, then types /mcp and its Enter, once nothing is asking', async () => {
    const tab = host(() => [...IDLE_281])
    const tree = await render(tab.client)
    await tapShowStatus(tree)
    expect(tab.terminalCalls()).toEqual(['terminal.read', 'terminal.send'])
    // The look is at the terminal the write goes to, not any other.
    expect(tab.reads()).toEqual([{ terminal: 'term-1', screen: true }])
    expect(tab.writes()).toEqual([{ terminal: 'term-1', text: '/mcp', enter: true }])
    expect(captions(tree, SEND_UNDER_DIALOG_REFUSAL)).toEqual([])
    expect(captions(tree, MCP_STATUS_NOT_SENT)).toEqual([])
  })

  // The look takes up to 2 s. A second tap meanwhile would look again and
  // could type a second /mcp into the first one's picker.
  it('holds the button while it looks, and lets it go after a refusal', async () => {
    let answer: (lines: string[]) => void = () => undefined
    const tab = host(() => new Promise<string[]>((resolve) => (answer = resolve)))
    const tree = await render(tab.client)
    await act(async () => {
      showStatusButton(tree).props.onPress()
      await settle()
    })
    expect(showStatusButton(tree).props.disabled).toBe(true)
    await act(async () => {
      answer([...PERMISSION_PROMPT_283])
      await settle()
    })
    expect(showStatusButton(tree).props.disabled).toBe(false)
    expect(captions(tree, SEND_UNDER_DIALOG_REFUSAL)).toHaveLength(1)
  })

  // The refusal is about the terminal the button offered. Once the lookup
  // stops offering one (the tab went busy), the words go with the button.
  it('drops the refusal with the button when the tab is no longer idle', async () => {
    const tab = host(() => [...PERMISSION_PROMPT_283])
    const tree = await render(tab.client)
    await tapShowStatus(tree)
    expect(captions(tree, SEND_UNDER_DIALOG_REFUSAL)).toHaveLength(1)
    // A new client (a reconnect) runs the lookup again, and the tab is blocked.
    fakes.client = host(() => [...PERMISSION_PROMPT_283], true, 'blocked').client
    await act(async () => {
      tree.update(panel('light'))
      await settle()
    })
    expect(showStatusButtons(tree)).toEqual([])
    expect(captions(tree, SEND_UNDER_DIALOG_REFUSAL)).toEqual([])
  })

  // Fails open, as /fork and every chat write do: a tap that cannot look goes
  // as it went before there was a look (mobile-native-chat-dialog-guard.ts).
  it('types /mcp as before when the screen read fails', async () => {
    const tab = host(() => Promise.reject(new Error('Connection closed')))
    const tree = await render(tab.client)
    await tapShowStatus(tree)
    expect(tab.terminalCalls()).toEqual(['terminal.read', 'terminal.send'])
    expect(tab.writes()).toEqual([{ terminal: 'term-1', text: '/mcp', enter: true }])
    expect(captions(tree, SEND_UNDER_DIALOG_REFUSAL)).toEqual([])
  })

  // The button used to drop a refused write without a word: a dead button
  // reads the same as a slow one.
  it('says so when the host does not take /mcp', async () => {
    const tab = host(() => [...IDLE_281], false)
    const tree = await render(tab.client)
    await tapShowStatus(tree)
    expect(tab.writes()).toHaveLength(1)
    expect(captions(tree, MCP_STATUS_NOT_SENT)).toHaveLength(1)
  })

  it('clears the refusal once a later tap goes through', async () => {
    let screen = PERMISSION_PROMPT_283
    const tab = host(() => [...screen])
    const tree = await render(tab.client)
    await tapShowStatus(tree)
    expect(captions(tree, SEND_UNDER_DIALOG_REFUSAL)).toHaveLength(1)
    screen = IDLE_281
    await tapShowStatus(tree)
    expect(tab.writes()).toHaveLength(1)
    expect(captions(tree, SEND_UNDER_DIALOG_REFUSAL)).toEqual([])
  })
})
