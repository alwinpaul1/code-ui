// The reading behind a created file's read-back count, against a fake host
// that answers `files.resolveTerminalPath` and `files.read` the way Orca does:
// a real rejected send, a real `binary_file` refusal, a path outside the
// workspace. One read per file per connection, only for rows that ask, a
// failed read retried when the relay connects again, and never a read for a
// file a later call touched.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  NativeChatBlock,
  NativeChatMessage,
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'
import type { RpcResponse } from '../transport/types'
import { cutCreateOf, type CutCreate } from './mobile-native-chat-created-file-count'
import {
  createCreatedFileCountStore,
  type CreatedFileCountStore
} from './mobile-native-chat-created-file-count-store'
import {
  CLAUDE_EDIT_RUN_ROWS,
  CREATED_A_FILE_RUN,
  CREATED_FILE_ON_DISK
} from './fixtures/claude-edit-runs-2.1.282'
import { asyncAgentLaunchResult } from './fixtures/claude-parallel-agents-2.1.281'

const CUT = '… (truncated)'
const WORKTREE_ROOT = '/Users/dev/Desktop/Project/Sample'
const PATH = ((CREATED_A_FILE_RUN[0] as NativeChatToolCallBlock).input as { file_path: string })
  .file_path

function success(result: unknown): RpcResponse {
  return { id: 'rpc', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function failure(code: string, message: string): RpcResponse {
  return { id: 'rpc', ok: false, error: { code, message }, _meta: { runtimeId: 'runtime-1' } }
}

function inWorktree(pathText: string): RpcResponse {
  const relativePath = pathText.slice(WORKTREE_ROOT.length + 1)
  return success({
    worktree: 'wt-1',
    relativePath,
    absolutePath: pathText,
    exists: true,
    isDirectory: false,
    openTarget: { kind: 'worktree-file', provider: 'local', relativePath, absolutePath: pathText }
  })
}

function fileText(content: string): RpcResponse {
  return success({
    worktree: 'wt-1',
    relativePath: 'x',
    content,
    truncated: false,
    byteLength: content.length
  })
}

type Params = { worktree?: string; pathText?: string; relativePath?: string }
type Handler = (params: Params) => RpcResponse | Promise<RpcResponse>

/** A host that answers by method; anything unlisted is a bug in the test. */
function fakeHost(handlers: Record<string, Handler>) {
  const calls: { method: string; params: Params }[] = []
  const sendRequest = vi.fn(async (method: string, params?: unknown) => {
    calls.push({ method, params: params as Params })
    const handler = handlers[method]
    if (!handler) {
      throw new Error(`unexpected ${method}`)
    }
    return handler(params as Params)
  })
  return {
    client: { sendRequest },
    calls,
    reads: () => calls.filter((entry) => entry.method === 'files.read').length
  }
}

/** A host with the fixture's file on disk, as the create made it. */
function hostWithFile(content = CREATED_FILE_ON_DISK) {
  return fakeHost({
    'files.resolveTerminalPath': (params) => inWorktree(params.pathText ?? ''),
    'files.read': () => fileText(content)
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const THE_CREATE: CutCreate = cutCreateOf(
  CREATED_A_FILE_RUN[0] as NativeChatToolCallBlock,
  CREATED_A_FILE_RUN[1] as NativeChatToolResultBlock
)!

function row(id: string, blocks: NativeChatBlock[]): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks,
    timestamp: null,
    source: 'transcript'
  } as NativeChatMessage
}

const LATER_EDIT = row('later-edit', [
  { type: 'tool-call', name: 'Edit', input: { file_path: PATH, old_string: 'a', new_string: 'b' } }
])

/** A second create, of `name` beside the fixture's file. */
function otherCreate(name: string): { create: CutCreate; rows: NativeChatMessage[] } {
  const path = `${WORKTREE_ROOT}/jobs/${name}`
  const call: NativeChatToolCallBlock = {
    type: 'tool-call',
    name: 'Write',
    input: { file_path: path, content: `${CREATED_FILE_ON_DISK.slice(0, 3896)}${CUT}` }
  }
  const result: NativeChatToolResultBlock = {
    type: 'tool-result',
    output: `File created successfully at: ${path}`
  }
  return {
    create: cutCreateOf(call, result)!,
    rows: [row(`${name}-call`, [call]), row(`${name}-result`, [result])]
  }
}

describe('reading back a created file the wire cut', () => {
  let store: CreatedFileCountStore
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    store = createCreatedFileCountStore()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
  })

  function configure(
    client: unknown,
    lastConnectedAt: number | null,
    worktreeId = 'wt-1',
    hostId = 'host-1'
  ) {
    store.configure({
      client: client as Parameters<CreatedFileCountStore['configure']>[0]['client'],
      hostId,
      worktreeId,
      lastConnectedAt
    })
  }

  it('counts +93 from the file, reading it once however many rows ask', async () => {
    const host = hostWithFile()
    configure(host.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    const releases = [store.want(THE_CREATE), store.want(THE_CREATE), store.want(THE_CREATE)]
    await settle()
    expect(store.countFor(THE_CREATE.key)).toBe(93)
    expect(host.reads()).toBe(1)
    for (const release of releases) {
      release()
    }
    store.want(THE_CREATE)
    await settle()
    expect(host.reads()).toBe(1)
    expect(store.countFor(THE_CREATE.key)).toBe(93)
  })

  it('reads inside the worktree it is shown for, with no chat provenance to mint a grant', async () => {
    const host = hostWithFile()
    configure(host.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    store.want(THE_CREATE)
    await settle()
    expect(host.calls).toEqual([
      { method: 'files.resolveTerminalPath', params: { worktree: 'id:wt-1', pathText: PATH } },
      {
        method: 'files.read',
        params: {
          worktree: 'id:wt-1',
          relativePath: 'hybrid-model/scripts/cluster/jobs/queue-sweep-k-one.sh'
        }
      }
    ])
  })

  it('tells the rows that asked once the count is in', async () => {
    const host = hostWithFile()
    configure(host.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    const listener = vi.fn()
    store.subscribe(listener)
    store.want(THE_CREATE)
    await settle()
    expect(listener).toHaveBeenCalled()
    expect(store.countFor(THE_CREATE.key)).toBe(93)
  })

  it('draws no number while the read is rejected, and counts once the relay reconnects', async () => {
    let offline = true
    const host = fakeHost({
      'files.resolveTerminalPath': (params) => {
        if (offline) {
          throw new Error('Not connected')
        }
        return inWorktree(params.pathText ?? '')
      },
      'files.read': () => fileText(CREATED_FILE_ON_DISK)
    })
    configure(host.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    store.want(THE_CREATE)
    await settle()
    expect(store.countFor(THE_CREATE.key)).toBeNull()
    expect(host.calls).toHaveLength(1)

    // The same connection, rendered again: no retry, so a host that stays
    // down is not asked in a loop.
    offline = false
    configure(host.client, 1)
    store.setTranscript([...CLAUDE_EDIT_RUN_ROWS], true)
    store.want(THE_CREATE)
    await settle()
    expect(host.calls).toHaveLength(1)
    expect(store.countFor(THE_CREATE.key)).toBeNull()

    configure(host.client, 2)
    store.setTranscript([...CLAUDE_EDIT_RUN_ROWS], true)
    await settle()
    expect(store.countFor(THE_CREATE.key)).toBe(93)
    expect(host.reads()).toBe(1)
  })

  it('reads again at once when the read failed on a connection already replaced', async () => {
    const first = deferred<RpcResponse>()
    let resolves = 0
    const host = fakeHost({
      'files.resolveTerminalPath': (params) => {
        resolves += 1
        return resolves === 1 ? first.promise : inWorktree(params.pathText ?? '')
      },
      'files.read': () => fileText(CREATED_FILE_ON_DISK)
    })
    configure(host.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    store.want(THE_CREATE)
    await settle()
    configure(host.client, 2)
    store.setTranscript([...CLAUDE_EDIT_RUN_ROWS], true)
    first.reject(new Error('socket closed'))
    await settle()
    expect(resolves).toBe(2)
    expect(store.countFor(THE_CREATE.key)).toBe(93)
  })

  it('never reads a file a later call in the transcript touched', async () => {
    const host = hostWithFile()
    configure(host.client, 1)
    store.setTranscript([...CLAUDE_EDIT_RUN_ROWS, LATER_EDIT], true)
    store.want(THE_CREATE)
    await settle()
    expect(host.calls).toHaveLength(0)
    expect(store.countFor(THE_CREATE.key)).toBeNull()
  })

  // Review of 2026-09-26: an agent launched in the background before the
  // create went on writing to it, and the chip drew the file's +125 for a
  // 93-line create. Its calls are in its own sidechain, not this transcript.
  it('draws no +125 for a 93-line create a background agent went on writing to', async () => {
    const grown = `${CREATED_FILE_ON_DISK}${'echo "added by the agent"\n'.repeat(32)}`
    const host = hostWithFile(grown)
    const agentId = 'ad17a815f19b6f5ae'
    const launch = [
      row('agent-call', [
        {
          type: 'tool-call',
          name: 'Agent',
          input: { description: 'Tidy the jobs', prompt: 'Tidy them', run_in_background: true }
        }
      ]),
      row('agent-launched', [{ type: 'tool-result', output: asyncAgentLaunchResult(agentId) }])
    ]
    configure(host.client, 1)
    store.setTranscript([...launch, ...CLAUDE_EDIT_RUN_ROWS], true)
    store.want(THE_CREATE)
    await settle()
    expect(store.countFor(THE_CREATE.key)).toBeNull()
    expect(host.reads()).toBe(0)
  })

  it('drops a count once a later call touches the file', async () => {
    const host = hostWithFile()
    configure(host.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    store.want(THE_CREATE)
    await settle()
    expect(store.countFor(THE_CREATE.key)).toBe(93)
    const listener = vi.fn()
    store.subscribe(listener)
    store.setTranscript([...CLAUDE_EDIT_RUN_ROWS, LATER_EDIT], true)
    expect(listener).toHaveBeenCalled()
    expect(store.countFor(THE_CREATE.key)).toBeNull()
  })

  it('draws no number for a file changed outside the transcript, and says why', async () => {
    const host = hostWithFile(CREATED_FILE_ON_DISK.replace('step 03', 'step 3b'))
    configure(host.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    store.want(THE_CREATE)
    await settle()
    expect(store.countFor(THE_CREATE.key)).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      `[created-file-count] no count for ${PATH}: changed since the create`
    )
  })

  it('does not read before the transcript holds the create', async () => {
    const host = hostWithFile()
    configure(host.client, 1)
    store.setTranscript([], true)
    store.want(THE_CREATE)
    await settle()
    expect(host.calls).toHaveLength(0)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    await settle()
    expect(store.countFor(THE_CREATE.key)).toBe(93)
  })

  it('asks nothing until there is a client, then reads', async () => {
    const host = hostWithFile()
    configure(null, null)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    store.want(THE_CREATE)
    await settle()
    expect(host.calls).toHaveLength(0)
    // The first connection brings the chat's transcript with it.
    configure(host.client, 1)
    store.setTranscript([...CLAUDE_EDIT_RUN_ROWS], true)
    await settle()
    expect(store.countFor(THE_CREATE.key)).toBe(93)
  })

  it('reads two files at a time, and never one no row wants any more', async () => {
    const gates = new Map<string, ReturnType<typeof deferred<RpcResponse>>>()
    const host = fakeHost({
      'files.resolveTerminalPath': (params) => {
        const gate = deferred<RpcResponse>()
        gates.set(params.pathText ?? '', gate)
        return gate.promise
      },
      'files.read': () => fileText(CREATED_FILE_ON_DISK)
    })
    const others = ['b.sh', 'c.sh', 'd.sh'].map(otherCreate)
    configure(host.client, 1)
    store.setTranscript([...CLAUDE_EDIT_RUN_ROWS, ...others.flatMap((other) => other.rows)], true)
    store.want(THE_CREATE)
    store.want(others[0]!.create)
    const releaseC = store.want(others[1]!.create)
    store.want(others[2]!.create)
    await settle()
    expect([...gates.keys()]).toEqual([PATH, others[0]!.create.path])
    releaseC()
    gates.get(PATH)!.resolve(inWorktree(PATH))
    await settle()
    expect([...gates.keys()]).toEqual([PATH, others[0]!.create.path, others[2]!.create.path])
    expect(store.countFor(THE_CREATE.key)).toBe(93)
    expect(store.countFor(others[1]!.create.key)).toBeNull()
  })

  it('settles a file outside the workspace without reading it, and does not ask again', async () => {
    const host = fakeHost({
      'files.resolveTerminalPath': () =>
        success({
          worktree: 'wt-1',
          relativePath: null,
          absolutePath: PATH,
          exists: false,
          isDirectory: false
        })
    })
    configure(host.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    store.want(THE_CREATE)
    await settle()
    configure(host.client, 2)
    await settle()
    expect(host.calls.map((entry) => entry.method)).toEqual(['files.resolveTerminalPath'])
    expect(store.countFor(THE_CREATE.key)).toBeNull()
  })

  it('draws no number for a file the host calls binary, and does not ask again', async () => {
    const host = fakeHost({
      'files.resolveTerminalPath': (params) => inWorktree(params.pathText ?? ''),
      'files.read': () => failure('binary_file', 'binary_file')
    })
    configure(host.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    store.want(THE_CREATE)
    await settle()
    configure(host.client, 2)
    await settle()
    expect(host.reads()).toBe(1)
    expect(store.countFor(THE_CREATE.key)).toBeNull()
    expect(warn).toHaveBeenCalledWith(`[created-file-count] no count for ${PATH}: binary_file`)
  })

  it('forgets every count when the chat moves to another worktree', async () => {
    const host = hostWithFile()
    configure(host.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    store.want(THE_CREATE)
    await settle()
    expect(store.countFor(THE_CREATE.key)).toBe(93)
    configure(host.client, 1, 'wt-2')
    expect(store.countFor(THE_CREATE.key)).toBeNull()
    store.setTranscript([...CLAUDE_EDIT_RUN_ROWS], true)
    store.want(THE_CREATE)
    await settle()
    expect(host.calls.at(-1)?.params.worktree).toBe('id:wt-2')
  })

  // Review of 2026-09-26: the retry after a reconnect went out before the
  // transcript that connection brings, so an Edit the agent made while the
  // phone was away was not in it yet, and the read counted the edited file.
  it('waits for the transcript a new connection brings before reading again', async () => {
    let offline = true
    let disk = CREATED_FILE_ON_DISK
    const host = fakeHost({
      'files.resolveTerminalPath': (params) => {
        if (offline) {
          throw new Error('Not connected')
        }
        return inWorktree(params.pathText ?? '')
      },
      'files.read': () => fileText(disk)
    })
    configure(host.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    store.want(THE_CREATE)
    await settle()
    disk = `${CREATED_FILE_ON_DISK}echo appended\n`
    offline = false
    configure(host.client, 2)
    await settle()
    expect(host.reads()).toBe(0)
    // The replay holds the Edit, so the file is never read at all.
    store.setTranscript([...CLAUDE_EDIT_RUN_ROWS, LATER_EDIT], true)
    await settle()
    expect(host.reads()).toBe(0)
    expect(store.countFor(THE_CREATE.key)).toBeNull()
  })

  it('does not read from a transcript the chat still holds over from before it loaded', async () => {
    const host = hostWithFile()
    configure(host.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, false)
    store.want(THE_CREATE)
    await settle()
    expect(host.calls).toHaveLength(0)
    store.setTranscript([...CLAUDE_EDIT_RUN_ROWS], true)
    await settle()
    expect(store.countFor(THE_CREATE.key)).toBe(93)
  })

  it('waits for the transcript of the worktree the chat moved to before reading there', async () => {
    const host = hostWithFile()
    configure(host.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    store.want(THE_CREATE)
    await settle()
    expect(host.calls).toHaveLength(2)
    configure(host.client, 1, 'wt-2')
    await settle()
    expect(host.calls).toHaveLength(2)
    store.setTranscript([...CLAUDE_EDIT_RUN_ROWS], true)
    await settle()
    expect(host.calls).toHaveLength(3)
    expect(host.calls.at(-1)?.params.worktree).toBe('id:wt-2')
  })

  // Review of 2026-09-26: a verdict was keyed by path and kept prefix alone,
  // so the same file made again in another session (a task re-run after
  // /clear) drew the first session's count without a read.
  it("reads the file again when another session creates it anew, rather than drawing the last one's count", async () => {
    let disk = CREATED_FILE_ON_DISK
    const host = fakeHost({
      'files.resolveTerminalPath': (params) => inWorktree(params.pathText ?? ''),
      'files.read': () => fileText(disk)
    })
    configure(host.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    const release = store.want(THE_CREATE)
    await settle()
    expect(store.countFor(THE_CREATE.key)).toBe(93)
    // The same session reloaded, through an empty window, is the same create.
    store.setTranscript([], true)
    store.setTranscript([...CLAUDE_EDIT_RUN_ROWS], true)
    await settle()
    expect(host.reads()).toBe(1)
    expect(store.countFor(THE_CREATE.key)).toBe(93)
    release()

    disk = `${CREATED_FILE_ON_DISK}${'echo more\n'.repeat(27)}`
    store.setTranscript(
      CLAUDE_EDIT_RUN_ROWS.map((message) => ({ ...message, id: `next-${message.id}` })),
      true
    )
    expect(store.countFor(THE_CREATE.key)).toBeNull()
    store.want(THE_CREATE)
    await settle()
    expect(host.reads()).toBe(2)
    expect(store.countFor(THE_CREATE.key)).toBe(120)
  })

  it("reads again for another session's create that loaded while the last one's read was out", async () => {
    const first = deferred<RpcResponse>()
    let disk = CREATED_FILE_ON_DISK
    const host = fakeHost({
      'files.resolveTerminalPath': (params) => inWorktree(params.pathText ?? ''),
      'files.read': () => (host.reads() === 1 ? first.promise : fileText(disk))
    })
    configure(host.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    store.want(THE_CREATE)
    await settle()
    expect(host.reads()).toBe(1)
    disk = `${CREATED_FILE_ON_DISK}${'echo more\n'.repeat(27)}`
    store.setTranscript(
      CLAUDE_EDIT_RUN_ROWS.map((message) => ({ ...message, id: `next-${message.id}` })),
      true
    )
    first.resolve(fileText(CREATED_FILE_ON_DISK))
    await settle()
    expect(host.reads()).toBe(2)
    expect(store.countFor(THE_CREATE.key)).toBe(120)
  })

  // Review of 2026-09-26: a read issued for one host wrote its verdict into
  // the entry after the chat had moved on, so the new host's file was judged
  // by the old one's.
  it('draws no number from a read of the last host that lands after the chat moved to another', async () => {
    const late = deferred<RpcResponse>()
    const oldHost = fakeHost({
      'files.resolveTerminalPath': () => late.promise,
      'files.read': () => fileText(CREATED_FILE_ON_DISK)
    })
    const newHost = hostWithFile(CREATED_FILE_ON_DISK.replace('step 03', 'step 3b'))
    configure(oldHost.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    store.want(THE_CREATE)
    await settle()
    configure(newHost.client, 7, 'wt-1', 'host-2')
    store.setTranscript([...CLAUDE_EDIT_RUN_ROWS], true)
    await settle()
    expect(newHost.reads()).toBe(1)
    expect(store.countFor(THE_CREATE.key)).toBeNull()
    late.resolve(inWorktree(PATH))
    await settle()
    expect(store.countFor(THE_CREATE.key)).toBeNull()
  })

  it("reads the new host's file when a read of the last host lands after the move", async () => {
    const late = deferred<RpcResponse>()
    const oldHost = fakeHost({
      'files.resolveTerminalPath': () => late.promise,
      'files.read': () => fileText(CREATED_FILE_ON_DISK)
    })
    const newHost = hostWithFile(CREATED_FILE_ON_DISK.replace('step 03', 'step 3b'))
    configure(oldHost.client, 1)
    store.setTranscript(CLAUDE_EDIT_RUN_ROWS, true)
    store.want(THE_CREATE)
    await settle()
    configure(null, null, 'wt-1', 'host-2')
    late.resolve(inWorktree(PATH))
    await settle()
    configure(newHost.client, 3, 'wt-1', 'host-2')
    store.setTranscript([...CLAUDE_EDIT_RUN_ROWS], true)
    await settle()
    expect(newHost.reads()).toBe(1)
    expect(store.countFor(THE_CREATE.key)).toBeNull()
  })
})
