import { AGENT_HUD_TERMINAL_TITLE } from './agent-hud-tab-filter'
import type { AgentHudRpcClient } from './agent-hud-snapshot'

type RpcResult = { ok?: boolean; result?: unknown }

function resultOf(response: unknown): Record<string, unknown> | null {
  const envelope = response as RpcResult | null
  if (!envelope || envelope.ok !== true || typeof envelope.result !== 'object') {
    return null
  }
  return (envelope.result ?? null) as Record<string, unknown> | null
}

/**
 * The shell each host+worktree keeps for the reader. It idles between reads
 * and bash's TMOUT ends it after 15 quiet minutes, so a phone that vanishes
 * leaves nothing behind. Before 2026-09-09 every read spawned and closed its
 * own terminal — one tab flicker per agent tab every 30 s on the desktop.
 */
const READER_SHELL_COMMAND =
  'TMOUT=900 exec bash --noprofile --norc -i 2>/dev/null || exec sh -i'
export const READER_POLL_FIRST_MS = 300
export const READER_POLL_MS = 250

const readerTerminals = new WeakMap<AgentHudRpcClient, Map<string, string>>()

/** Test seam: the polling delay. */
export const agentHudReaderTiming = {
  delay: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
}

export function rememberedReader(client: AgentHudRpcClient, worktree: string): string | null {
  return readerTerminals.get(client)?.get(worktree) ?? null
}

export function rememberReader(client: AgentHudRpcClient, worktree: string, terminal: string | null): void {
  let byWorktree = readerTerminals.get(client)
  if (!byWorktree) {
    byWorktree = new Map()
    readerTerminals.set(client, byWorktree)
  }
  if (terminal) {
    byWorktree.set(worktree, terminal)
  } else {
    byWorktree.delete(worktree)
  }
}

export async function openReaderTerminal(
  client: AgentHudRpcClient,
  worktree: string,
  timeoutMs: number
): Promise<string | null> {
  const created = resultOf(
    await client.sendRequest(
      'terminal.create',
      {
        worktree,
        command: READER_SHELL_COMMAND,
        presentation: 'background',
        // Why: the desktop adopts even background terminals as tabs; the
        // title lets the phone hide them, surfaceOwner asks it not to.
        title: AGENT_HUD_TERMINAL_TITLE,
        surfaceOwner: false
      },
      { timeoutMs }
    )
  )
  const handle = created?.terminal
  const terminal = typeof handle === 'string' ? handle : readHandle(handle)
  rememberReader(client, worktree, terminal)
  return terminal
}

export async function sendReaderCommand(
  client: AgentHudRpcClient,
  terminal: string,
  command: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    const sent = resultOf(
      await client.sendRequest(
        'terminal.send',
        { terminal, text: command, enter: true },
        { timeoutMs }
      )
    )
    return sent !== null
  } catch {
    return false
  }
}

export async function readReaderOutput(
  client: AgentHudRpcClient,
  worktree: string,
  terminal: string,
  outPath: string,
  timeoutMs: number
): Promise<string | null> {
  const resolved = resultOf(
    await client.sendRequest(
      'files.resolveTerminalPath',
      { worktree, pathText: outPath, terminal, crossWorkspace: true },
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
  return typeof content === 'string' ? content : null
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
