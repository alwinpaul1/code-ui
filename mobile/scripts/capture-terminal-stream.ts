/**
 * Records a real terminal stream — the bytes the phone's terminal view would
 * receive — with the arrival time of every chunk, for replaying into a
 * terminal engine under production load (see app/ghostty-spike.tsx).
 *
 * Subscribes the way the app does: binary stream, mobile client, and a phone
 * viewport so the host fits the PTY to those dims before serializing
 * scrollback — the snapshot and every later chunk are shaped exactly as a
 * phone sees them. Taking a viewport is also the take-floor gesture (the
 * desk's keyboard pauses on that terminal), so the script always
 * unsubscribes, Ctrl-C included.
 *
 * Usage:
 *   pnpm exec tsx scripts/capture-terminal-stream.ts --terminal <handle> \
 *     --viewport 51x38 [--seconds 30] [--out captures/stage0.json]
 *
 * Token and E2EE key are read from Orca's user data directory
 * (ORCA_USER_DATA, default ~/Library/Application Support/orca).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import WebSocket from 'ws'
import type {
  TerminalStreamCapture,
  TerminalStreamCaptureEvent
} from '../src/terminal/terminal-stream-capture'
import {
  handleTerminalBinaryFrame,
  type TerminalSnapshotState
} from '../src/transport/rpc-client-terminal-binary-frame'
import { CaptureRpc, type RpcResponse } from './capture-terminal-stream-rpc'

const WS_URL = process.env.ORCA_MOBILE_WS_URL ?? 'ws://127.0.0.1:6768'
const USER_DATA =
  process.env.ORCA_USER_DATA ?? `${process.env.HOME}/Library/Application Support/orca`

type Args = {
  terminal: string
  viewport: { cols: number; rows: number } | null
  seconds: number
  out: string
  /** Sent in order, the first after 1 s, the rest `promptGapSeconds` apart. */
  prompts: string[]
  promptGapSeconds: number
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    terminal: '',
    viewport: null,
    seconds: 30,
    out: 'captures/stage0.json',
    prompts: [],
    promptGapSeconds: 30
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--terminal' && value) {
      args.terminal = value
      i += 1
    } else if (flag === '--viewport' && value) {
      const match = /^(\d+)x(\d+)$/.exec(value)
      if (!match) {
        throw new Error(`--viewport expects COLSxROWS, got ${value}`)
      }
      args.viewport = { cols: Number(match[1]), rows: Number(match[2]) }
      i += 1
    } else if (flag === '--seconds' && value) {
      args.seconds = Number(value)
      i += 1
    } else if (flag === '--out' && value) {
      args.out = value
      i += 1
    } else if (flag === '--prompt' && value) {
      args.prompts.push(value)
      i += 1
    } else if (flag === '--prompt-gap' && value) {
      args.promptGapSeconds = Number(value)
      i += 1
    }
  }
  if (!args.terminal) {
    throw new Error(
      'Usage: pnpm exec tsx scripts/capture-terminal-stream.ts --terminal <handle> --viewport COLSxROWS [--seconds 30] [--out captures/stage0.json] [--prompt <text>]... [--prompt-gap 30]'
    )
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const rpc = new CaptureRpc(USER_DATA)
const clientId = `stage0-capture-${Date.now()}`
let subscribeId: string | null = null
// Why: the host refuses a mobile subscribe without the binary stream
// (`binary_terminal_stream_required`), so output arrives as encrypted binary
// frames; decode them with the app's own decoder so the events match production.
const terminalSnapshots = new Map<number, TerminalSnapshotState>()
let streamId: number | null = null

const capture: TerminalStreamCapture = {
  version: 1,
  placeholder: false,
  capturedAt: new Date().toISOString(),
  terminal: args.terminal,
  viewport: args.viewport,
  cols: null,
  rows: null,
  serialized: '',
  events: []
}
let streamStartedAt = 0
let snapshotSeen = false
const otherEventTypes = new Map<string, number>()

function onStreamEvent(result: Record<string, unknown>): void {
  const now = performance.now()
  if (streamStartedAt === 0) {
    streamStartedAt = now
  }
  const t = Math.round((now - streamStartedAt) * 100) / 100
  // Why: only the first snapshot is the init; a later one would be a resize
  // re-stream, which the replay reports rather than reproduces.
  if (result.type === 'scrollback' && !snapshotSeen) {
    snapshotSeen = true
    capture.cols = typeof result.cols === 'number' ? result.cols : null
    capture.rows = typeof result.rows === 'number' ? result.rows : null
    capture.serialized = typeof result.serialized === 'string' ? result.serialized : ''
    return
  }
  if (result.type === 'data' && typeof result.chunk === 'string') {
    const event: TerminalStreamCaptureEvent = { t, type: 'data', chunk: result.chunk }
    capture.events.push(event)
    return
  }
  if (result.type === 'resized' || result.type === 'scrollback') {
    capture.events.push({
      t,
      type: 'resized',
      cols: typeof result.cols === 'number' ? result.cols : null,
      rows: typeof result.rows === 'number' ? result.rows : null,
      serialized: typeof result.serialized === 'string' ? result.serialized : null
    })
    return
  }
  const type = typeof result.type === 'string' ? result.type : 'unknown'
  otherEventTypes.set(type, (otherEventTypes.get(type) ?? 0) + 1)
}

async function unsubscribe(ws: WebSocket): Promise<void> {
  if (!subscribeId) {
    return
  }
  subscribeId = null
  await rpc
    .send(ws, 'terminal.unsubscribe', {
      subscriptionId: `${args.terminal}:${clientId}`,
      client: { id: clientId }
    })
    .catch(() => null)
}

function save(): void {
  const outPath = resolve(process.cwd(), args.out)
  // Why: a terminal that had already gone away answers with `end` and nothing
  // else; writing that would blank a good capture at the same path.
  if (!snapshotSeen && capture.events.length === 0) {
    console.error(`nothing recorded — ${outPath} left untouched`)
    return
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(capture))
  const dataEvents = capture.events.filter((event) => event.type === 'data')
  const chunkUnits = dataEvents.reduce(
    (sum, event) => sum + (event.type === 'data' ? event.chunk.length : 0),
    0
  )
  const lastT = capture.events.length > 0 ? capture.events[capture.events.length - 1]!.t : 0
  const syncWraps = dataEvents.filter(
    (event) => event.type === 'data' && event.chunk.includes('[?2026h')
  ).length
  console.log(`saved: ${outPath}`)
  console.log(`snapshot: ${capture.cols}x${capture.rows}, ${capture.serialized.length} UTF-16 units`)
  console.log(
    `stream: ${dataEvents.length} data chunks, ${chunkUnits} units over ${(lastT / 1000).toFixed(1)}s, ${syncWraps} chunks open ?2026h`
  )
  console.log(`resize re-streams recorded: ${capture.events.length - dataEvents.length}`)
  for (const [type, count] of otherEventTypes) {
    console.log(`ignored ${type}: ${count}`)
  }
}

async function run(ws: WebSocket): Promise<void> {
  await rpc.handshake(ws)
  subscribeId = rpc.nextId('capture')
  rpc.sendRaw(ws, {
    id: subscribeId,
    deviceToken: rpc.token,
    method: 'terminal.subscribe',
    params: {
      terminal: args.terminal,
      client: { id: clientId, type: 'mobile' },
      capabilities: { terminalBinaryStream: 1 },
      ...(args.viewport ? { viewport: args.viewport } : {})
    }
  })
  console.log(
    `subscribed ${args.terminal} as ${clientId}${args.viewport ? ` at ${args.viewport.cols}x${args.viewport.rows}` : ' (no viewport: host keeps its own dims)'}; recording ${args.seconds}s`
  )
  const startedAt = Date.now()
  // Why sent here, as this client: a viewport subscribe holds the terminal's
  // floor, and desk input (`orca terminal send` included) is refused while it
  // does — prompts have to come from the phone-side client that holds it.
  for (const [index, prompt] of args.prompts.entries()) {
    const dueAt = startedAt + 1000 + index * args.promptGapSeconds * 1000
    await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(0, dueAt - Date.now())))
    const sent = await rpc.send(ws, 'terminal.send', {
      terminal: args.terminal,
      text: prompt,
      enter: true,
      client: { id: clientId, type: 'mobile' }
    })
    const accepted = (sent.result?.send as { accepted?: boolean } | undefined)?.accepted
    console.log(
      `prompt ${index + 1} at +${((Date.now() - startedAt) / 1000).toFixed(1)}s ${accepted ? 'accepted' : `refused: ${JSON.stringify(sent.error ?? sent.result)}`}`
    )
  }
  const endAt = startedAt + args.seconds * 1000
  await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(0, endAt - Date.now())))
  await unsubscribe(ws)
  save()
}

const ws = new WebSocket(WS_URL)

ws.on('open', () => {
  run(ws)
    .then(() => {
      ws.close()
      process.exit(0)
    })
    .catch((error: Error) => {
      console.error(error.message)
      ws.close()
      process.exit(1)
    })
})

ws.on('message', (data, isBinary) => {
  if (isBinary) {
    const bytes = rpc.decryptBytes(new Uint8Array(data as Buffer))
    if (bytes) {
      handleTerminalBinaryFrame(bytes, {
        terminalSnapshots,
        getListener: (id) =>
          id === streamId
            ? (result) => onStreamEvent(result as Record<string, unknown>)
            : undefined
      })
    }
    return
  }
  let plaintext: string | null = null
  try {
    plaintext = rpc.decrypt(data.toString())
  } catch {
    return
  }
  if (!plaintext) {
    return
  }
  const response = JSON.parse(plaintext) as RpcResponse
  if (response.streaming && response.id === subscribeId && response.result) {
    if (response.result.type === 'subscribed' && typeof response.result.streamId === 'number') {
      streamId = response.result.streamId
    }
    onStreamEvent(response.result)
    return
  }
  if (response.id === subscribeId && !response.ok) {
    console.error(`subscribe failed: ${JSON.stringify(response.error)}`)
    process.exit(1)
  }
  rpc.settle(response)
})

ws.on('error', (error) => {
  console.error(`WebSocket error: ${error.message}`)
  process.exit(1)
})

process.on('SIGINT', () => {
  console.log('\ninterrupted: unsubscribing and saving what was recorded')
  unsubscribe(ws)
    .catch(() => null)
    .then(() => {
      save()
      ws.close()
      process.exit(0)
    })
})
