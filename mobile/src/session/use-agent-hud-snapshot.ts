import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { readMobileRuntimeHostPlatform } from '../transport/mobile-runtime-host-platform'
import {
  readAgentHudSnapshot,
  type AgentHudSnapshot,
  type AgentHudSnapshotTarget
} from './agent-hud-snapshot'

/** The command is a POSIX shell one-liner — `printf | base64 -d | node -`,
 *  `/tmp`, `2>/dev/null`. On a Windows host every part of that is wrong, and
 *  without this gate a background terminal would be created, fail and be closed
 *  twice a minute. An unknown platform counts as unsupported: better no
 *  snapshot than a terminal that cannot work. */
export function isPosixHost(platform: NodeJS.Platform | null): boolean {
  return platform !== null && platform !== 'win32' && platform !== 'cygwin'
}

/** A whole shell round trip, so it runs on its own slow clock. The screen poll
 *  stays at 1 Hz for the things only the screen has — a permission dialog is
 *  not in the transcript until it has been answered. */
export const AGENT_HUD_SNAPSHOT_INTERVAL_MS = 30_000

/** Ask the agent what it says about itself, instead of reading what a status
 *  line happened to draw.
 *
 *  The screen only carries the model, effort and context when the user runs a
 *  status line at all, and then only as wrapped, truncated text at whatever
 *  precision that status line chose. Both agents already write the same facts
 *  to disk as JSON — Claude Code to its transcript, Codex to its rollout — and
 *  Codex's rollout carries its real rate-limit windows too. Reading those needs
 *  nothing installed or configured on the desktop. */
export function useAgentHudSnapshot(args: {
  client: RpcClient | null
  enabled: boolean
  worktree: string | null
  agent: string | null | undefined
  /** Orca already reports this on the tab's agent status for Claude. */
  transcriptPath?: string | null
  sessionId?: string | null
  cwd?: string | null
  /** Changes whenever the active terminal changes; restarts the snapshot. */
  scopeKey: string | null
}): { snapshot: AgentHudSnapshot | null; refresh: () => Promise<AgentHudSnapshot | null> } {
  const [snapshot, setSnapshot] = useState<AgentHudSnapshot | null>(null)
  const latest = useRef(args)
  latest.current = args
  const readRef = useRef<() => Promise<AgentHudSnapshot | null>>(async () => null)
  const [hostPlatform, setHostPlatform] = useState<NodeJS.Platform | null>(null)
  const hostPlatformRef = useRef<NodeJS.Platform | null>(null)
  hostPlatformRef.current = hostPlatform

  useEffect(() => {
    setSnapshot(null)
  }, [args.scopeKey])

  useEffect(() => {
    let active = true
    const client = args.client
    if (!client || !args.enabled) {
      return
    }
    void (async () => {
      try {
        const response = await client.sendRequest('status.get', {}, { timeoutMs: 8_000 })
        const result = (response as { ok?: boolean; result?: unknown })?.ok
          ? (response as { result?: unknown }).result
          : null
        if (active) {
          setHostPlatform(readMobileRuntimeHostPlatform(result))
        }
      } catch {
        // Left unknown, which the gate below treats as unsupported.
      }
    })()
    return () => {
      active = false
    }
  }, [args.client, args.enabled])

  useEffect(() => {
    let active = true
    let inFlight = false
    const read = async (): Promise<AgentHudSnapshot | null> => {
      const current = latest.current
      const agent = current.agent === 'codex' ? 'codex' : 'claude'
      if (
        !active ||
        inFlight ||
        !current.client ||
        !current.enabled ||
        !current.worktree ||
        !isPosixHost(hostPlatformRef.current) ||
        (current.agent !== 'claude' && current.agent !== 'codex')
      ) {
        return null
      }
      // Claude is addressed by its transcript; without one there is nothing to
      // read and guessing another session's file would report someone else's
      // context as this tab's.
      const target: AgentHudSnapshotTarget =
        agent === 'claude'
          ? { agent, transcriptPath: current.transcriptPath ?? null }
          : { agent, sessionId: current.sessionId ?? null, cwd: current.cwd ?? null }
      if (agent === 'claude' && !target.transcriptPath) {
        return null
      }
      if (agent === 'codex' && !target.sessionId && !target.cwd) {
        return null
      }
      inFlight = true
      try {
        const next = await readAgentHudSnapshot({
          client: current.client,
          worktree: current.worktree,
          target,
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
        })
        if (!active || !next || next.error) {
          return null
        }
        setSnapshot(next)
        return next
      } finally {
        inFlight = false
      }
    }
    readRef.current = read
    void read()
    return () => {
      active = false
      readRef.current = async () => null
    }
    // transcriptPath and sessionId are deps: quitting an agent and starting
    // another in the same tab keeps the handle and the scope key, so without
    // them the previous session's model and context would stand for 30 s.
  }, [
    args.scopeKey,
    args.client,
    args.enabled,
    args.worktree,
    args.agent,
    args.transcriptPath,
    args.sessionId,
    hostPlatform
  ])

  useEffect(() => {
    if (!args.client || !args.enabled || !args.scopeKey) {
      return
    }
    const timer = setInterval(() => void readRef.current(), AGENT_HUD_SNAPSHOT_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [args.client, args.enabled, args.scopeKey])

  const refresh = useCallback(() => readRef.current(), [])
  return { snapshot, refresh }
}
