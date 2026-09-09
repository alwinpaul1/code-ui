import { AGENT_HUD_READER_SOURCE } from './agent-hud-reader-source'

/** One reading of an agent's own session record, taken on the host.
 *
 *  Why not the terminal screen: the screen only carries these numbers when the
 *  user happens to run a status line, it is wrapped and truncated by the pane
 *  width, and the figures it shows are whatever that status line chose to
 *  render. The agents write the same facts to disk themselves, in JSON, with no
 *  setup at all — Claude Code to its transcript, Codex to its rollout. */
export type AgentHudSnapshot = {
  agent: 'claude' | 'codex'
  model: string | null
  effort: string | null
  agentVersion: string | null
  contextUsedTokens: number | null
  /** Null when the size is genuinely not knowable — see `contextWindowSource`.
   *  A guessed window is worse than none: naming 500k for a 1M session reads as
   *  99% full when it is half full. */
  contextWindowTokens: number | null
  contextWindowSource:
    | 'reported-by-agent'
    | 'model-id'
    | 'statusline-cache'
    /** Derived from the session's own numbers — a session cannot have held more
     *  tokens than its window. This is the case for a user with nothing
     *  installed, so it must not be mislabelled as unknown. */
    | 'inferred-from-session'
    | 'unknown'
  /** Claude's own permission mode, or Codex's approval policy. */
  mode: string | null
  planType: string | null
  limits: AgentHudLimitWindow[]
  error: string | null
}

export type AgentHudLimitWindow = {
  usedPercent: number
  windowMinutes: number | null
  resetsAt: number | null
}

export const AGENT_HUD_SNAPSHOT_MAX_BYTES = 64 * 1024

/** The one directory both the host's grant guard and the phone can name. */
export const AGENT_HUD_SNAPSHOT_DIR = '/tmp'

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function limitWindow(value: unknown): AgentHudLimitWindow | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const raw = value as { usedPercent?: unknown; windowMinutes?: unknown; resetsAt?: unknown }
  const usedPercent = positive(raw.usedPercent)
  if (usedPercent === null) {
    return null
  }
  return {
    usedPercent: Math.min(100, usedPercent),
    windowMinutes: positive(raw.windowMinutes),
    resetsAt: positive(raw.resetsAt)
  }
}

const WINDOW_SOURCES = new Set([
  'reported-by-agent',
  'model-id',
  'statusline-cache',
  'inferred-from-session',
  'unknown'
])

/** Parse what the reader printed. Anything unrecognised degrades to null rather
 *  than throwing: a HUD that shows one field less is fine, one that disappears
 *  because a field changed shape is not. */
export function parseAgentHudSnapshot(raw: string): AgentHudSnapshot | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const value = parsed as Record<string, unknown>
  const agent = value.agent === 'codex' ? 'codex' : value.agent === 'claude' ? 'claude' : null
  if (!agent) {
    return null
  }
  const source = text(value.contextWindowSource)
  const limits = [limitWindow(value.primaryLimit), limitWindow(value.secondaryLimit)].filter(
    (window): window is AgentHudLimitWindow => window !== null
  )
  return {
    agent,
    model: text(value.model),
    effort: text(value.effort),
    agentVersion: text(value.agentVersion),
    contextUsedTokens: positive(value.contextUsedTokens),
    contextWindowTokens: positive(value.contextWindowTokens),
    contextWindowSource:
      source && WINDOW_SOURCES.has(source)
        ? (source as AgentHudSnapshot['contextWindowSource'])
        : 'unknown',
    mode: text(value.permissionMode) ?? text(value.approvalPolicy),
    planType: text(value.planType),
    limits,
    error: text(value.error)
  }
}

/** Used / window as a whole percent, or null when the window is not known. */
export function agentHudContextPercent(snapshot: AgentHudSnapshot): number | null {
  const { contextUsedTokens: used, contextWindowTokens: size } = snapshot
  if (used === null || size === null || size <= 0) {
    return null
  }
  return Math.max(0, Math.min(100, Math.round((used / size) * 100)))
}

export type AgentHudSnapshotTarget = {
  agent: 'claude' | 'codex'
  /** Claude: the transcript Orca already reports on the tab's agent status. */
  transcriptPath?: string | null
  /** Codex: its session id when known; the cwd is the fallback discriminator. */
  sessionId?: string | null
  cwd?: string | null
}

/** Base64 keeps the script clear of every shell quoting hazard: the payload is
 *  only `A-Za-z0-9+/=`, so no amount of quoting in the reader can escape it. */
export function encodeAgentHudReader(
  source: string = AGENT_HUD_READER_SOURCE,
  toBase64: (value: string) => string = defaultBase64
): string {
  return toBase64(source)
}

function defaultBase64(value: string): string {
  if (typeof globalThis.btoa === 'function') {
    // React Native's btoa is latin1-only; the reader is ASCII, but encode the
    // bytes rather than the code units so a future non-ASCII comment cannot
    // silently corrupt it.
    const bytes = utf8Bytes(value)
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return globalThis.btoa(binary)
  }
  return bufferBase64(value)
}

function utf8Bytes(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value)
  }
  return bufferBytes(value)
}

function bufferBase64(value: string): string {
  const globalBuffer = (globalThis as { Buffer?: { from(input: string, enc: string): { toString(enc: string): string } } })
    .Buffer
  return globalBuffer ? globalBuffer.from(value, 'utf8').toString('base64') : ''
}

function bufferBytes(value: string): Uint8Array {
  const globalBuffer = (globalThis as { Buffer?: { from(input: string, enc: string): Uint8Array } })
    .Buffer
  return globalBuffer ? globalBuffer.from(value, 'utf8') : new Uint8Array()
}

/** Shell-single-quote a value: the only metacharacter inside '...' is ', and
 *  '\'' closes, escapes and reopens. Paths from the host can hold anything. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export type AgentHudSnapshotCommand = {
  /** The one-liner to hand `terminal.create`. */
  command: string
  /** Where the reader will leave its JSON; read this back, then close. */
  outPath: string
}

/** Build the throwaway command. It writes the reader to the temp dir, runs it,
 *  redirects its JSON beside it, and deletes the script — so the only thing
 *  left is the one small file the phone is about to read, in the one directory
 *  the host will grant a read on. Nothing is installed and nothing persists. */
export function buildAgentHudSnapshotCommand(args: {
  target: AgentHudSnapshotTarget
  /** Unique per run; the grant pins the file's identity, so reuse would race. */
  id: string
  readerBase64?: string
}): AgentHudSnapshotCommand {
  const encoded = args.readerBase64 ?? encodeAgentHudReader()
  if (!/^[A-Za-z0-9]+$/.test(args.id)) {
    // The id is interpolated into the command unquoted, so it is the one value
    // that must not be able to carry shell syntax.
    throw new Error('Snapshot id must be alphanumeric')
  }
  const base = `orca-hud-${args.id}`
  // A literal /tmp, not $TMPDIR: the phone has to name this path back to the
  // host to read it, and it cannot expand a host shell variable. Both /tmp and
  // its realpath /private/tmp are inside the roots the host will grant a
  // terminal file read on (macOS and Linux; Windows takes the screen path).
  const dir = AGENT_HUD_SNAPSHOT_DIR
  const out = `${dir}/${base}.json`
  const { target } = args
  const flags: string[] = ['--agent', shellQuote(target.agent)]
  if (target.agent === 'claude') {
    flags.push('--transcript', shellQuote(target.transcriptPath ?? ''))
  } else {
    if (target.sessionId) {
      flags.push('--session', shellQuote(target.sessionId))
    }
    // Orca creates the terminal in the worktree, so the shell's own $PWD is the
    // directory a Codex session there was started in — which is what its
    // rollout records. That closes the case the phone cannot address: a Codex
    // launched from the desktop carries no session id the phone can see.
    // Deliberately unquoted at the outside so the host shell expands it, and
    // double-quoted within so a path with spaces survives.
    flags.push('--cwd', target.cwd ? shellQuote(target.cwd) : '"$PWD"')
  }
  // Nothing is written to the host but the small JSON result. The reader is
  // piped straight into node's stdin and never saved as a file: `node -` takes
  // the script from stdin and its arguments after it.
  //
  // The reader writes the output itself, with a rename, so the path is never
  // seen half-written. A `> out` redirect would create it empty the instant the
  // shell started, which is exactly what the phone would then read.
  flags.push('--out', shellQuote(out))
  // node is not guaranteed: codex-cli is a Rust binary and Claude Code's native
  // installer ships a standalone one. Without this the command wrote nothing,
  // the phone read nothing, and a terminal was spawned every 30 s forever with
  // no HUD and no explanation anywhere. Say so in the file instead.
  const reader = `printf %s ${encoded} | base64 -d | node - ${flags.join(' ')}`
  const noNode = `printf '{"agent":%s,"error":"node-missing","readerVersion":1}' ${shellQuote(
    `"${target.agent}"`
  )} > ${shellQuote(out)}`
  const command = `if command -v node > /dev/null 2>&1; then ${reader}; else ${noNode}; fi; exit`
  return { command, outPath: out }
}

export type AgentHudRpcClient = {
  sendRequest: (
    method: string,
    params: Record<string, unknown>,
    options?: Record<string, unknown>
  ) => Promise<unknown>
}

type RpcResult = { ok?: boolean; result?: unknown }

function resultOf(response: unknown): Record<string, unknown> | null {
  const envelope = response as RpcResult | null
  if (!envelope || envelope.ok !== true || typeof envelope.result !== 'object') {
    return null
  }
  return (envelope.result ?? null) as Record<string, unknown> | null
}

/** Take one snapshot: spawn a throwaway shell that writes the JSON, read the
 *  file back through the grant the host already gives for temp-dir artifacts,
 *  and close the tab. Every step is allowlisted for mobile clients on stock
 *  Orca, and a mobile client's terminal is created in the background, so the
 *  desktop does not steal focus.
 *
 *  Returns null rather than throwing: the HUD keeps its previous reading and
 *  the screen parse stays available underneath. */
export async function readAgentHudSnapshot(args: {
  client: AgentHudRpcClient
  worktree: string
  target: AgentHudSnapshotTarget
  id: string
  readerBase64?: string
  /** The snapshot is a whole shell round trip, so it is deliberately slower
   *  than a screen read and must never sit in front of the user's own writes. */
  timeoutMs?: number
}): Promise<AgentHudSnapshot | null> {
  const { client, worktree } = args
  const timeoutMs = args.timeoutMs ?? 12_000
  const built = buildAgentHudSnapshotCommand({
    target: args.target,
    id: args.id,
    ...(args.readerBase64 ? { readerBase64: args.readerBase64 } : {})
  })
  let terminal: string | null = null
  try {
    const created = resultOf(
      await client.sendRequest(
        'terminal.create',
        { worktree, command: built.command, presentation: 'background' },
        { timeoutMs }
      )
    )
    const handle = created?.terminal
    terminal = typeof handle === 'string' ? handle : readHandle(handle)
    if (!terminal) {
      return null
    }
    // terminal.create returns when the terminal EXISTS, not when its command
    // has run. The reader takes ~130 ms, so resolving straight away either
    // found nothing or pinned the grant to a file the reader then rewrote,
    // which the host rejects as stale. The client deadline must exceed the
    // server's, or the transport rejects before the host's own answer can get
    // back and the `finally` below closes the terminal mid-read.
    await client.sendRequest(
      'terminal.wait',
      { terminal, for: 'exit', timeoutMs },
      { timeoutMs: timeoutMs + 5_000 }
    )
    const resolved = resultOf(
      await client.sendRequest(
        'files.resolveTerminalPath',
        { worktree, pathText: built.outPath, terminal, crossWorkspace: true },
        { timeoutMs }
      )
    )
    const target = resolved?.openTarget as
      | { kind?: string; absolutePath?: string; grantId?: string }
      | undefined
    if (target?.kind !== 'absolute-file' || !target.absolutePath || !target.grantId) {
      return null
    }
    const read = resultOf(
      await client.sendRequest(
        'files.readTerminalArtifact',
        {
          worktree: resolved?.worktree ? `id:${String(resolved.worktree)}` : worktree,
          absolutePath: target.absolutePath,
          grantId: target.grantId
        },
        { timeoutMs }
      )
    )
    const content = read?.content
    return typeof content === 'string' ? parseAgentHudSnapshot(content) : null
  } catch {
    return null
  } finally {
    if (terminal) {
      // Best effort and NOT awaited: the reader ends with `exit`, so the shell
      // is already gone if this never lands, and the snapshot is in hand —
      // waiting for the close was one more round trip before the pills painted.
      client.sendRequest('terminal.close', { terminal }, { timeoutMs: 4_000 }).catch(() => {
        /* the shell exits on its own */
      })
    }
  }
}

function readHandle(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as { handle?: unknown; id?: unknown }
  if (typeof record.handle === 'string') {
    return record.handle
  }
  return typeof record.id === 'string' ? record.id : null
}
