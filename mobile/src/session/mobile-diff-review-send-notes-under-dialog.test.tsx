import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  StyleSheet: { create: (styles: unknown) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default }
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  Copy: 'Copy',
  Edit3: 'Edit3',
  FileText: 'FileText',
  Plus: 'Plus',
  Send: 'Send',
  Trash2: 'Trash2',
  X: 'X'
}))
// The sheet's content as drawn while it is open; the drawer's native
// animation is not what these tests are about.
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: unknown }) => (visible ? children : null)
}))
vi.mock('../components/ConfirmModal', () => ({ ConfirmModal: () => null }))
vi.mock('../platform/haptics', () => ({
  triggerError: vi.fn(),
  triggerImpact: vi.fn(),
  triggerSelection: vi.fn(),
  triggerSuccess: vi.fn(),
  triggerWarning: vi.fn()
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))

vi.mock('./mobile-diff-review-loaders', () => ({
  loadMobileDiffReviewSnapshot: vi.fn(async () => ({
    kind: 'ready',
    status: { entries: [], conflictOperation: 'none' },
    branchCompare: null,
    comments: [
      {
        id: 'note-1',
        worktreeId: 'wt-1',
        filePath: 'src/app.ts',
        lineNumber: 4,
        body: 'needs a test',
        createdAt: 1,
        side: 'modified'
      }
    ],
    reviewState: { version: 1, files: {} }
  })),
  loadMobileDiffReviewDiff: vi.fn(async () => ({ kind: 'idle' }))
}))

import { MobileDiffReviewDrawers } from '../components/MobileDiffReviewDrawers'
import { createFakeRpcClient } from '../mobile-web-shell/bridge-host-test-fakes'
import { ThemeProvider } from '../theme/theme-context'
import type { RpcResponse } from '../transport/types'
import { darkColors, lightColors } from '../theme/tokens'
import { SEND_UNDER_DIALOG_REFUSAL } from './mobile-native-chat-dialog-guard'
import {
  isMobileNativeChatInputStale,
  markMobileNativeChatInputStale,
  resetMobileNativeChatStaleInputForTests
} from './mobile-native-chat-stale-input'
import { useMobileDiffReviewController } from './use-mobile-diff-review-controller'
import { STALE_INPUT_NOT_CLEARED } from './use-mobile-diff-review-send-actions'

const MARKER = /^=== screen: (.*) ===$/

/** A capture under fixtures/: the screen after its `=== screen: <name> ===`
 *  line (the first one when unnamed), or a marker-less file's rows after its
 *  `# ` header. */
function readScreen(file: string, name?: string): string[] {
  const text = readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)), 'utf8')
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
// highlighted, the one that sat unanswered for eight hours. The notes typed
// into it are keys for the prompt, and their Enter approves the command.
// (Transcribed from the user's screenshot, not a tmux capture: the fixture's
// header lists the bytes it cannot vouch for.)
const PERMISSION_PROMPT_283 = readScreen('claude-screen-subagent-bash-permission-2.1.283.txt')
// Claude Code 2.1.282, `tmux capture-pane -p`: an AskUserQuestion menu with
// option 1 highlighted, whose Enter picks it.
const QUESTION_MENU_282 = readScreen('claude-screen-ask-single-select-2.1.282.txt', 'ask')
// Claude Code 2.1.281, `tmux capture-pane -p`: idle, nothing asking, its `❯`
// input row (a no-break space after the glyph) at the bottom.
const IDLE_281 = readScreen('claude-screen-sent-photos-2.1.281.txt')

// Codex 0.153.4's model picker, `orca terminal read --screen`, 2026-09-05
// (codex-picker-screen.test.ts; mobile-native-chat-dialog-guard.test.ts reads
// the same capture). Its Enter picks a model.
const CODEX_MODEL_PICKER = [
  '  Select Model and Effort',
  '  Access legacy models by running codex -m <model_name> or in your config.toml',
  '  1. gpt-6-astra (default)  Our most capable model for complex, demanding work.',
  '› 2. gpt-5.6-sol (current)  Reliable agentic workhorse for everyday tasks.',
  '  3. gpt-5.6-terra          Balanced agentic coding model for everyday work.',
  '  Press enter to confirm or esc to go back'
]
// The picker under a row of command output that is a bare `❯` at column 0, as
// a shell prompt prints it: composed the way the dialog guard's own "sees a
// Codex approval under command output that printed a ❯ prompt" case is. Read
// with no agent, Claude's input-row rule takes that row for Claude's input and
// calls the screen clear.
const CODEX_PICKER_UNDER_PROMPT_OUTPUT = ['• Ran starship prompt', '❯', '', ...CODEX_MODEL_PICKER]

const TERMINAL = 'term-1'
const TERMINAL_ROW = 'Claude (term-1)'
const OTHER_TERMINAL = 'term-2'
const OTHER_TERMINAL_ROW = 'Codex (term-2)'
const NEW_TERMINAL = 'term-new'
const NEW_SESSION_ROW = 'New Agent Session'

type Call = { method: string; params: Record<string, unknown> }
type Reply = RpcResponse | Promise<RpcResponse>

const ok = (result: unknown): RpcResponse => ({ id: 'reply', ok: true, result })
const refused = (message: string, code = 'refused'): RpcResponse => ({ id: 'reply', ok: false, error: { code, message } })

/** A lost send whose error carries no message, the recorder's
 *  "transport-rejection-no-message" partition. */
function messageless(): Error {
  const error = new Error('lost')
  error.message = ''
  return error
}

const CLAUDE_TAB = { type: 'terminal', id: 'tab-1', terminal: TERMINAL, title: 'Claude' }
const CODEX_TAB = { type: 'terminal', id: 'tab-2', terminal: OTHER_TERMINAL, title: 'Codex' }

/**
 * A connected host whose worktree lists `tabs` (one Claude terminal unless
 * told otherwise). `screen` answers a screen read of any terminal, `send` a
 * write, `create` a new tab, `save` the notes' sent marks, `list` the tab
 * list. Every RPC the review screen makes on its own (the PR sidebar's) stays
 * unanswered.
 */
function host({
  screen,
  tabs = [CLAUDE_TAB],
  list = () => ok({ tabs }),
  send = () => ok({ send: { accepted: true } }),
  create = () => ok({ tab: { type: 'terminal', id: 'tab-9', terminal: NEW_TERMINAL, title: 'Terminal' } }),
  save = () => ok({ ok: true })
}: {
  screen: () => string[] | Promise<string[]>
  tabs?: Record<string, unknown>[]
  list?: () => Reply
  send?: () => Reply
  create?: () => Reply
  save?: () => Reply
}) {
  const calls: Call[] = []
  const client = createFakeRpcClient({}, async (method, params) => {
    calls.push({ method, params: params as Record<string, unknown> })
    switch (method) {
      case 'session.tabs.list':
        return list()
      case 'terminal.read':
        return ok({ terminal: { lines: await screen(), source: 'screen' } })
      case 'terminal.send':
        return send()
      case 'session.tabs.createTerminal':
        return create()
      case 'worktree.set':
        return save()
      default:
        return new Promise<RpcResponse>(() => {})
    }
  })
  return {
    client,
    terminalCalls: () => calls.filter((call) => call.method.startsWith('terminal.')),
    writes: () => calls.filter((call) => call.method === 'terminal.send').map((call) => call.params)
  }
}

let controller: ReturnType<typeof useMobileDiffReviewController> | null = null

function Review({ client }: { client: ReturnType<typeof host>['client'] }) {
  controller = useMobileDiffReviewController({
    client,
    connState: 'connected',
    hostId: 'host-1',
    worktreeId: 'wt-1',
    name: 'review',
    initialFilter: 'all',
    initialTarget: null,
    onOpenSession: () => {},
    onReconnect: null
  })
  return <MobileDiffReviewDrawers controller={controller} />
}

/** Lets a tap's screen read, its writes and the state they set all land. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

let tree: ReactTestRenderer | null = null
let warn: MockInstance<(...args: unknown[]) => void>

/** The review with its Send Notes sheet open on the worktree's terminals. */
async function openSheet(tab: ReturnType<typeof host>, scheme: 'light' | 'dark' = 'light'): Promise<ReactTestRenderer> {
  await act(async () => {
    tree = create(
      <ThemeProvider initialPreference={scheme}>
        <Review client={tab.client} />
      </ThemeProvider>
    )
    await settle()
  })
  await act(async () => {
    await controller!.openSendSheet()
    await settle()
  })
  return tree!
}

function textNodes(rendered: ReactTestRenderer, text: string): ReactTestInstance[] {
  return rendered.root.findAll((node) => String(node.type) === 'Text' && node.props.children === text)
}

function sheetRow(rendered: ReactTestRenderer, label: string): ReactTestInstance {
  const [row] = rendered.root.findAll(
    (node) =>
      String(node.type) === 'Pressable' &&
      node.findAll((child) => String(child.type) === 'Text' && child.props.children === label).length > 0
  )
  if (!row) {
    throw new Error(`the Send Notes sheet has no "${label}" row`)
  }
  return row
}

async function tap(rendered: ReactTestRenderer, label: string): Promise<void> {
  await act(async () => {
    sheetRow(rendered, label).props.onPress()
    await settle()
  })
}

function colorOf(node: ReactTestInstance): unknown {
  const style: unknown = node.props.style
  const entries = (Array.isArray(style) ? style.flat(Infinity) : [style]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...entries).color
}

/** The lines the send wrote to the log about itself. */
function sendLog(): string[] {
  return warn.mock.calls.map((args) => args.map(String).join(' ')).filter((line) => line.startsWith('[review-send]'))
}

beforeEach(() => {
  resetMobileNativeChatStaleInputForTests()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  act(() => tree?.unmount())
  tree = null
  controller = null
  warn.mockRestore()
})

// The sheet cannot see the terminal it lists. On 2026-09-27 a subagent's
// Bash prompt sat on screen for eight hours with "Yes" highlighted; notes and
// their Enter typed into it would have approved the command.
describe('Send Notes into an agent terminal the sheet cannot see', () => {
  it.each([
    ['a permission prompt (Claude Code 2.1.283)', PERMISSION_PROMPT_283],
    ['a question menu (Claude Code 2.1.282)', QUESTION_MENU_282]
  ] as const)('does not type review notes into a terminal that is showing %s', async (_name, lines) => {
    const tab = host({ screen: () => [...lines] })
    const rendered = await openSheet(tab)
    await tap(rendered, TERMINAL_ROW)
    expect(tab.writes()).toEqual([])
    // The sheet stays up on the refusal, rows and all, so a retry is one tap.
    expect(textNodes(rendered, SEND_UNDER_DIALOG_REFUSAL)).toHaveLength(1)
    expect(sheetRow(rendered, TERMINAL_ROW).props.disabled).toBe(false)
    expect(controller!.unsentComments).toHaveLength(1)
  })

  // The stale-input heal is a Ctrl+U, and a prompt takes that key as well:
  // the look comes before it, not between it and the notes.
  it('does not clear a marked terminal under a prompt either, and keeps the mark for the next send', async () => {
    markMobileNativeChatInputStale(TERMINAL)
    const tab = host({ screen: () => [...PERMISSION_PROMPT_283] })
    const rendered = await openSheet(tab)
    await tap(rendered, TERMINAL_ROW)
    expect(tab.terminalCalls().map((call) => call.method)).toEqual(['terminal.read'])
    expect(isMobileNativeChatInputStale(TERMINAL)).toBe(true)
  })

  it('looks at the screen, then types the notes and their Enter, once nothing is asking', async () => {
    const tab = host({ screen: () => [...IDLE_281] })
    const rendered = await openSheet(tab)
    await tap(rendered, TERMINAL_ROW)
    expect(tab.terminalCalls().map((call) => call.method)).toEqual(['terminal.read', 'terminal.send'])
    // The look is at the terminal the notes go to, not any other.
    expect(tab.terminalCalls()[0]!.params).toEqual({ terminal: TERMINAL, screen: true })
    expect(tab.writes()).toEqual([expect.objectContaining({ terminal: TERMINAL, enter: true })])
    expect(String(tab.writes()[0]!.text)).toContain('needs a test')
    expect(controller!.sendSheet).toBeNull()
    expect(controller!.actionError).toBe('Review notes sent')
  })

  it('looks before it clears a marked terminal, then clears it, then sends', async () => {
    markMobileNativeChatInputStale(TERMINAL)
    const tab = host({ screen: () => [...IDLE_281] })
    const rendered = await openSheet(tab)
    await tap(rendered, TERMINAL_ROW)
    expect(tab.terminalCalls().map((call) => [call.method, call.params.text ?? null])).toEqual([
      ['terminal.read', null],
      ['terminal.send', '\x15'],
      ['terminal.send', expect.stringContaining('needs a test')]
    ])
    expect(isMobileNativeChatInputStale(TERMINAL)).toBe(false)
  })

  // Fails open, as /fork, /mcp and every chat write do: a send that cannot
  // look goes as it went before there was a look.
  it('types the notes as before when the screen read fails', async () => {
    const tab = host({ screen: () => Promise.reject(new Error('Connection closed')) })
    const rendered = await openSheet(tab)
    await tap(rendered, TERMINAL_ROW)
    expect(tab.terminalCalls().map((call) => call.method)).toEqual(['terminal.read', 'terminal.send'])
    expect(tab.writes()).toEqual([expect.objectContaining({ terminal: TERMINAL, enter: true })])
    expect(textNodes(rendered, SEND_UNDER_DIALOG_REFUSAL)).toEqual([])
    expect(controller!.sendSheet).toBeNull()
  })

  // A tab the sheet created a moment ago has no prompt on it, so it is not
  // looked at. Pinned so the look is not spread to it: it would cost the
  // send up to 2 s against a screen that is still starting.
  it('does not look at the terminal a New Agent Session creates', async () => {
    const tab = host({ screen: () => [...PERMISSION_PROMPT_283] })
    const rendered = await openSheet(tab)
    await tap(rendered, NEW_SESSION_ROW)
    expect(tab.terminalCalls().map((call) => [call.method, call.params.terminal])).toEqual([
      ['terminal.send', NEW_TERMINAL]
    ])
    expect(controller!.sendSheet).toBeNull()
  })

  // The look takes up to 2 s. A second tap meanwhile would look again and
  // type the same notes twice.
  it('holds the rows while it looks, and lets them go after a refusal', async () => {
    let answer: (lines: string[]) => void = () => undefined
    const tab = host({ screen: () => new Promise<string[]>((resolve) => (answer = resolve)) })
    const rendered = await openSheet(tab)
    await tap(rendered, TERMINAL_ROW)
    expect(sheetRow(rendered, TERMINAL_ROW).props.disabled).toBe(true)
    expect(sheetRow(rendered, NEW_SESSION_ROW).props.disabled).toBe(true)
    await act(async () => {
      answer([...PERMISSION_PROMPT_283])
      await settle()
    })
    expect(sheetRow(rendered, TERMINAL_ROW).props.disabled).toBe(false)
    expect(sheetRow(rendered, NEW_SESSION_ROW).props.disabled).toBe(false)
    expect(tab.terminalCalls().map((call) => call.method)).toEqual(['terminal.read'])
  })
})

// The sheet's rows run from a tap with nowhere for a rejection to go. A
// failed send used to leave no trace: the sheet sat there as before, and a
// dead button read the same as a slow one.
describe('says why the notes were not sent', () => {
  it.each([
    ['the terminal refuses the write', ok({ send: { accepted: false } }), 'Terminal input is locked'],
    ['the desktop refuses the send', refused('pane gone'), 'pane gone']
  ] as const)('says why the notes were not sent when %s', async (_name, reply, why) => {
    const tab = host({ screen: () => [...IDLE_281], send: () => reply })
    const rendered = await openSheet(tab)
    await tap(rendered, TERMINAL_ROW)
    expect(tab.writes()).toHaveLength(1)
    expect(textNodes(rendered, why)).toHaveLength(1)
    expect(controller!.sendSheet).toMatchObject({ kind: 'error', message: why })
    expect(sheetRow(rendered, TERMINAL_ROW).props.disabled).toBe(false)
    expect(sendLog()).toEqual([expect.stringContaining(why)])
    expect(sendLog()[0]).toContain(TERMINAL)
  })

  it('says why the notes were not sent when the send throws', async () => {
    const tab = host({ screen: () => [...IDLE_281], send: () => Promise.reject(new Error('Connection closed')) })
    const rendered = await openSheet(tab)
    await tap(rendered, TERMINAL_ROW)
    expect(textNodes(rendered, 'Connection closed')).toHaveLength(1)
    expect(sendLog()).toEqual([expect.stringContaining('Connection closed')])
  })

  it('says why the notes were not sent when a prompt is waiting, in the log too', async () => {
    const tab = host({ screen: () => [...PERMISSION_PROMPT_283] })
    const rendered = await openSheet(tab)
    await tap(rendered, TERMINAL_ROW)
    expect(textNodes(rendered, SEND_UNDER_DIALOG_REFUSAL)).toHaveLength(1)
    expect(sendLog()).toEqual([expect.stringContaining(SEND_UNDER_DIALOG_REFUSAL)])
  })

  it('says why the notes were not sent when the stale input could not be cleared first', async () => {
    markMobileNativeChatInputStale(TERMINAL)
    const tab = host({ screen: () => [...IDLE_281], send: () => ok({ send: { accepted: false } }) })
    const rendered = await openSheet(tab)
    await tap(rendered, TERMINAL_ROW)
    // Only the failed clear went out, never the notes.
    expect(tab.writes()).toEqual([expect.objectContaining({ text: '\x15', enter: false })])
    // Named for its cause: the send's own refusal says "Failed to send notes".
    expect(textNodes(rendered, STALE_INPUT_NOT_CLEARED)).toHaveLength(1)
    expect(sendLog()).toEqual([expect.stringContaining(STALE_INPUT_NOT_CLEARED)])
    expect(isMobileNativeChatInputStale(TERMINAL)).toBe(true)
  })

  // The terminal took the notes; only saving them as sent failed. Saying
  // "not sent" there would invite the same notes a second time.
  it('does not say the notes were not sent when only marking them sent failed', async () => {
    const tab = host({ screen: () => [...IDLE_281], save: () => refused('disk full') })
    const rendered = await openSheet(tab)
    await tap(rendered, TERMINAL_ROW)
    expect(tab.writes()).toHaveLength(1)
    expect(controller!.sendSheet).toBeNull()
    expect(controller!.actionError).toBe('Review notes sent, but not marked sent: disk full')
    expect(sendLog()).toEqual([])
  })

  it('says why the notes were not sent when the New Agent Session cannot be created', async () => {
    const tab = host({
      screen: () => [...IDLE_281],
      create: () => refused('Workspace is busy', 'worktree_busy')
    })
    const rendered = await openSheet(tab)
    await tap(rendered, NEW_SESSION_ROW)
    expect(tab.writes()).toEqual([])
    expect(textNodes(rendered, 'Workspace is busy')).toHaveLength(1)
    expect(sendLog()).toEqual([expect.stringContaining('Workspace is busy')])
  })

  it.each([
    ['light', lightColors.danger],
    ['dark', darkColors.danger]
  ] as const)('draws why the notes were not sent in the %s theme’s danger colour', async (scheme, danger) => {
    const tab = host({ screen: () => [...PERMISSION_PROMPT_283] })
    const rendered = await openSheet(tab, scheme)
    await tap(rendered, TERMINAL_ROW)
    const [caption] = textNodes(rendered, SEND_UNDER_DIALOG_REFUSAL)
    expect(caption).toBeDefined()
    expect(colorOf(caption!)).toBe(danger)
  })

  it('drops the reason once a later tap goes through', async () => {
    let lines = PERMISSION_PROMPT_283
    const tab = host({ screen: () => [...lines] })
    const rendered = await openSheet(tab)
    await tap(rendered, TERMINAL_ROW)
    expect(textNodes(rendered, SEND_UNDER_DIALOG_REFUSAL)).toHaveLength(1)
    lines = IDLE_281
    await tap(rendered, TERMINAL_ROW)
    expect(tab.writes()).toHaveLength(1)
    expect(controller!.sendSheet).toBeNull()
    expect(textNodes(rendered, SEND_UNDER_DIALOG_REFUSAL)).toEqual([])
  })
})

/** A promise and the function that settles it, for a reply the test times. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => (resolve = settle))
  return { promise, resolve }
}

// A send outlives the sheet it started from: the look alone can take 2 s.
// Its failure used to be written into whatever the sheet was by then: a
// closed sheet reopened as an error with no terminals in it, and a sheet
// reopened and still loading had the reason overwritten by the loaded list.
describe('a Send Notes failure that lands after the sheet moved on', () => {
  it('does not reopen a sheet the user closed, and says why on the review banner', async () => {
    const look = deferred<string[]>()
    const tab = host({ screen: () => look.promise })
    const rendered = await openSheet(tab)
    await tap(rendered, TERMINAL_ROW)
    act(() => controller!.setSendSheet(null))
    await act(async () => {
      look.resolve([...PERMISSION_PROMPT_283])
      await settle()
    })
    expect(tab.writes()).toEqual([])
    expect(controller!.sendSheet).toBeNull()
    expect(controller!.actionError).toBe(SEND_UNDER_DIALOG_REFUSAL)
    expect(sendLog()).toEqual([expect.stringContaining(SEND_UNDER_DIALOG_REFUSAL)])
  })

  it('keeps the reason for a reopened sheet still loading its list, and shows it with the list', async () => {
    const look = deferred<string[]>()
    let listing: ReturnType<typeof deferred<RpcResponse>> | null = null
    const tab = host({
      screen: () => look.promise,
      list: () => {
        if (!listing) {
          return ok({ tabs: [CLAUDE_TAB] })
        }
        return listing.promise
      }
    })
    const rendered = await openSheet(tab)
    await tap(rendered, TERMINAL_ROW)
    act(() => controller!.setSendSheet(null))
    listing = deferred<RpcResponse>()
    await act(async () => {
      void controller!.openSendSheet()
      await settle()
    })
    expect(controller!.sendSheet).toMatchObject({ kind: 'loading' })
    await act(async () => {
      look.resolve([...PERMISSION_PROMPT_283])
      await settle()
    })
    await act(async () => {
      listing!.resolve(ok({ tabs: [CLAUDE_TAB] }))
      await settle()
    })
    expect(controller!.sendSheet).toMatchObject({ kind: 'error', message: SEND_UNDER_DIALOG_REFUSAL })
    expect(textNodes(rendered, SEND_UNDER_DIALOG_REFUSAL)).toHaveLength(1)
    expect(sheetRow(rendered, TERMINAL_ROW).props.disabled).toBe(false)
  })

  // The same late write from the other side: a list that arrives after the
  // user closed the sheet opened it again.
  it('does not reopen a sheet the user closed while its list was loading', async () => {
    const listing = deferred<RpcResponse>()
    const tab = host({ screen: () => [...IDLE_281], list: () => listing.promise })
    await act(async () => {
      tree = create(
        <ThemeProvider initialPreference="light">
          <Review client={tab.client} />
        </ThemeProvider>
      )
      await settle()
    })
    await act(async () => {
      void controller!.openSendSheet()
      await settle()
    })
    act(() => controller!.setSendSheet(null))
    await act(async () => {
      listing.resolve(ok({ tabs: [CLAUDE_TAB] }))
      await settle()
    })
    expect(controller!.sendSheet).toBeNull()
  })
})

// One send at a time. The rows' disabled flag only lands on the next render,
// so a second tap before it would look again and type the notes twice.
describe('two taps on Send Notes', () => {
  it('types the notes once when a row is tapped twice before the sheet redraws', async () => {
    const tab = host({ screen: () => [...IDLE_281] })
    const rendered = await openSheet(tab)
    await act(async () => {
      const row = sheetRow(rendered, TERMINAL_ROW)
      row.props.onPress()
      row.props.onPress()
      await settle()
    })
    expect(tab.terminalCalls().map((call) => call.method)).toEqual(['terminal.read', 'terminal.send'])
  })

  it("holds the other terminal's row while one sends, and lets it go after", async () => {
    const look = deferred<string[]>()
    const tab = host({ screen: () => look.promise, tabs: [CLAUDE_TAB, CODEX_TAB] })
    const rendered = await openSheet(tab)
    await tap(rendered, TERMINAL_ROW)
    expect(sheetRow(rendered, OTHER_TERMINAL_ROW).props.disabled).toBe(true)
    await act(async () => {
      look.resolve([...PERMISSION_PROMPT_283])
      await settle()
    })
    expect(sheetRow(rendered, OTHER_TERMINAL_ROW).props.disabled).toBe(false)
  })
})

describe('notes the terminal took but could not be marked sent', () => {
  it('still names a reason when the lost save carries no message', async () => {
    const tab = host({ screen: () => [...IDLE_281], save: () => Promise.reject(messageless()) })
    const rendered = await openSheet(tab)
    await tap(rendered, TERMINAL_ROW)
    expect(tab.writes()).toHaveLength(1)
    expect(controller!.sendSheet).toBeNull()
    expect(controller!.actionError).toBe('Review notes sent, but not marked sent: Failed to save review')
  })
})

// The sheet's tabs carry the host's own word for their agent. Read without it,
// the look applies Claude's input-row rule to a Codex tab, and a bare `❯` row
// of output above a live Codex menu reads as Claude's input: no dialog.
describe('Send Notes into a Codex tab', () => {
  it.each([
    ['the agent it was launched as', { ...CODEX_TAB, launchAgent: 'codex' }],
    ["the agent Orca's hooks report", { ...CODEX_TAB, agentStatus: { agentType: 'codex', state: 'waiting' } }]
  ] as const)(
    'does not type review notes into a Codex menu under a ❯ row of output, knowing %s',
    async (_name, codexTab) => {
      const tab = host({ screen: () => [...CODEX_PICKER_UNDER_PROMPT_OUTPUT], tabs: [codexTab] })
      const rendered = await openSheet(tab)
      await tap(rendered, OTHER_TERMINAL_ROW)
      expect(tab.writes()).toEqual([])
      expect(textNodes(rendered, SEND_UNDER_DIALOG_REFUSAL)).toHaveLength(1)
    }
  )

  it('still sends into a Codex tab once nothing is asking', async () => {
    const tab = host({
      screen: () => ['• ok', '› Ask Codex to do anything', '  gpt-5.6-sol xhigh · ~/Project'],
      tabs: [{ ...CODEX_TAB, launchAgent: 'codex' }]
    })
    const rendered = await openSheet(tab)
    await tap(rendered, OTHER_TERMINAL_ROW)
    expect(tab.writes()).toEqual([expect.objectContaining({ terminal: OTHER_TERMINAL, enter: true })])
  })
})
