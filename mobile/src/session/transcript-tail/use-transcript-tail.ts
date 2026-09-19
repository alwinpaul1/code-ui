import { useEffect, useMemo, useState } from 'react'
import type { RpcClient } from '../../transport/rpc-client'
import { readMobileRuntimeHostPlatform } from '../../transport/mobile-runtime-host-platform'
import { taskRuntimeStatusRead } from '../../tasks/mobile-task-runtime-operations'
import { acquireTranscriptTail } from './transcript-tail-session'
import { transcriptTailFile } from './transcript-tail-command'
import { EMPTY_TRANSCRIPT_TAIL_STATE, type TranscriptTailState } from './transcript-tail-records'
import { mergeDesktopPrompts, mergeQueuedMessages } from './transcript-tail-merge'
import type { DesktopPrompt } from '../agent-hud-beacon'

/** Which command shape a host takes, by host, remembered for the process:
 *  the answer does not change while the app runs. */
const platformByHost = new Map<string, 'win32' | 'posix'>()
const platformReads = new Map<string, Promise<'win32' | 'posix'>>()

async function readPlatform(client: RpcClient, hostId: string): Promise<'win32' | 'posix'> {
  const known = platformByHost.get(hostId)
  if (known) {
    return known
  }
  let read = platformReads.get(hostId)
  if (!read) {
    read = (async () => {
      try {
        const response = await taskRuntimeStatusRead.request(client)
        const status = taskRuntimeStatusRead.interpret(response)
        const platform = readMobileRuntimeHostPlatform(status) === 'win32' ? 'win32' : 'posix'
        platformByHost.set(hostId, platform)
        return platform
      } finally {
        platformReads.delete(hostId)
      }
    })()
    platformReads.set(hostId, read)
  }
  return read
}

/**
 * The live layer of a Claude session's transcript, for the chat over a
 * terminal tab — hand-started sessions included, since nothing here needs
 * the agent to have been launched with anything.
 *
 * Empty until the terminal is up and reading; empty for good when the host
 * refuses the terminal, and the chat then shows what it always did.
 */
export function useTranscriptTail(args: {
  client: RpcClient | null
  hostId: string
  worktreeId: string
  transcriptPath: string | null
  /** The fallback name for the file when the host disclosed no path. */
  sessionId: string | null
  enabled: boolean
}): TranscriptTailState {
  const { client, hostId, worktreeId, transcriptPath, sessionId, enabled } = args
  const [state, setState] = useState<TranscriptTailState>(EMPTY_TRANSCRIPT_TAIL_STATE)
  useEffect(() => {
    const file = transcriptTailFile(transcriptPath, sessionId)
    if (!client || !enabled || !file) {
      setState(EMPTY_TRANSCRIPT_TAIL_STATE)
      return
    }
    let cancelled = false
    let release: (() => void) | null = null
    let unsubscribe: (() => void) | null = null
    // No platform, no tail: a POSIX command on a Windows host opens a tab
    // that does nothing, and the entry would keep it for its whole life.
    // The next mount asks again.
    void readPlatform(client, hostId)
      .catch(() => null)
      .then((platform) => {
        if (cancelled || platform === null) {
          return
        }
        const lease = acquireTranscriptTail(client, { hostId, worktreeId, file, platform })
        release = lease.release
        setState(lease.getState())
        unsubscribe = lease.subscribe(() => setState(lease.getState()))
      })
    return () => {
      cancelled = true
      unsubscribe?.()
      release?.()
      setState(EMPTY_TRANSCRIPT_TAIL_STATE)
    }
  }, [client, enabled, hostId, sessionId, transcriptPath, worktreeId])
  return state
}

const NO_PROMPTS: DesktopPrompt[] = []

/** The transcript's prompts merged with the beacon's, memoized so the
 *  overlay's own memos hold. Also what confirms a phone send on a
 *  hand-started session, where no beacon ever will. */
export function useTranscriptTailPrompts(
  tail: TranscriptTailState,
  beaconPrompts: readonly DesktopPrompt[] | undefined
): DesktopPrompt[] {
  const prompts = beaconPrompts ?? NO_PROMPTS
  return useMemo(() => mergeDesktopPrompts(tail.prompts, prompts), [prompts, tail.prompts])
}

/** The transcript's queue merged with the rows the screen draws. */
export function useTranscriptTailQueue(
  tail: TranscriptTailState,
  screenQueue: readonly string[] | undefined
): string[] {
  return useMemo(() => mergeQueuedMessages(screenQueue, tail.queue), [screenQueue, tail.queue])
}
