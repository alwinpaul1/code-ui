import { useEffect, useRef, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { createCodexPickerIo } from './codex-picker-apply'
import { isCodexIdle, isCodexWorking, parseCodexPickerScreen } from './codex-picker-screen'
import { withCodexTerminalLock } from './codex-terminal-lock'
import {
  codexVisibleModelsKey,
  hasScrapedCodexVisibleModels,
  scrapeCodexVisibleModels
} from './codex-visible-models'
import {
  acquireMobileNativeChatTerminalWrite,
  releaseMobileNativeChatTerminalWrite
} from './mobile-native-chat-terminal-write-lock'

const SETTLE_AFTER_TURN_MS = 700
const MODEL_READ_RETRY_MS = 1_000
const MODEL_READ_ATTEMPTS = 3

export function useCodexStatusPoll(args: {
  client: RpcClient | null
  hostId: string
  worktreeId: string
  /** Codex chat is showing over a live terminal. */
  enabled: boolean
  working: boolean
  hasDraft?: boolean
  beforeWrite?: () => Promise<void>
  handleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  /** Restarts the "once on open" poll when the terminal changes. */
  handleKey: string | null
  refreshHud: () => Promise<unknown>
}): void {
  const { client, enabled, working, handleRef, deviceTokenRef, handleKey, refreshHud } = args
  const { hostId, worktreeId, hasDraft = false, beforeWrite } = args
  const previousWorking = useRef(working)
  const polledOnOpen = useRef<string | null>(null)

  useEffect(() => {
    const wasWorking = previousWorking.current
    previousWorking.current = working
    if (!client || !enabled || !handleKey || hasDraft) {
      return
    }
    const turnEnded = wasWorking && !working
    const firstOpen = polledOnOpen.current !== handleKey && !working
    if (!turnEnded && !firstOpen) {
      return
    }
    polledOnOpen.current = handleKey
    let active = true
    const visibleKey = codexVisibleModelsKey(hostId, worktreeId)
    let attempts = 0
    let timer: ReturnType<typeof setTimeout>
    const poll = (): void => {
      attempts += 1
      const handle = handleRef.current
      if (!active || !handle) {
        return
      }
      void withCodexTerminalLock(handle, async () => {
        if (!active || !acquireMobileNativeChatTerminalWrite(handle)) {
          return
        }
        try {
          await beforeWrite?.()
          if (!active) {
            return
          }
          const io = createCodexPickerIo({
            client,
            terminal: handle,
            deviceToken: deviceTokenRef.current
          })
          // Self-heal: a picker left open (an apply cut off by a disconnect or a
          // backgrounded app) swallows every send. Escape it first — never while
          // a turn runs, since Esc there interrupts the agent.
          let lines = await io.readScreen()
          for (let attempt = 0; attempt < 3 && parseCodexPickerScreen(lines); attempt += 1) {
            // An open model picker already contains the answer: let the reader
            // consume it before cleanup instead of closing and reopening it.
            if (
              parseCodexPickerScreen(lines)?.step === 'model' &&
              !hasScrapedCodexVisibleModels(visibleKey)
            ) {
              break
            }
            if (!active || isCodexWorking(lines)) {
              return
            }
            await io.sendKey('\x1b')
            await io.sleep(400)
            lines = await io.readScreen()
          }
          // Only discover models on an idle input; a working turn owns the terminal.
          if (!isCodexIdle(lines) && parseCodexPickerScreen(lines)?.step !== 'model') {
            return
          }
          // Learn which models this session can pick by reading Codex's own picker
          // (the host probe lists hidden ones and misses some). Retried on every
          // idle open / turn end until it succeeds once.
          if (!hasScrapedCodexVisibleModels(visibleKey)) {
            const models = await scrapeCodexVisibleModels(io, visibleKey, lines)
            if (!active || !models) {
              return
            }
          }
          if (active) {
            await refreshHud()
          }
        } finally {
          releaseMobileNativeChatTerminalWrite(handle)
        }
      })
        .catch(() => {
          // A relay handoff can interrupt any read; retry below after releasing
          // the terminal lock. Never leave an unhandled rejection in the effect.
        })
        .finally(() => {
          if (
            active &&
            !hasScrapedCodexVisibleModels(visibleKey) &&
            attempts < MODEL_READ_ATTEMPTS
          ) {
            timer = setTimeout(poll, MODEL_READ_RETRY_MS)
          }
        })
    }
    // A fresh idle chat needs no post-turn settling delay.
    timer = setTimeout(poll, firstOpen ? 0 : SETTLE_AFTER_TURN_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [
    client,
    hasDraft,
    beforeWrite,
    deviceTokenRef,
    enabled,
    handleKey,
    handleRef,
    hostId,
    refreshHud,
    working,
    worktreeId
  ])
}
