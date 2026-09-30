import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'
import {
  parseCodexHudObservation,
  parseTerminalHudObservation,
  type TerminalHudObservation
} from './mobile-terminal-hud-parse'
import { claudePermissionFromScreen } from './claude-terminal-permission'
import { isMobileNativeChatTerminalBurstActive } from './mobile-native-chat-terminal-write-lock'
import { codexQueuedMessagesFromScreen } from './codex-terminal-queued-messages'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import { codexPermissionFromScreen } from './codex-terminal-permission'
import { sentPromptsFromScreen } from './mobile-terminal-sent-prompts'
import { sentPhotosFromScreen, type ScreenSentPhotos } from './mobile-terminal-sent-photos'
import { taskCompletionsFromScreen } from './mobile-terminal-task-completions'
import { peerNoticesFromScreen, type ScreenPeerRow } from './mobile-terminal-peer-notices'
import type { ScreenTaskCompletion } from './mobile-background-tasks'
import { permissionOptionsFromScreen } from './mobile-terminal-permission-options'
import { parseClaudeSpinnerLine, sameSpinner, type ClaudeSpinner } from './mobile-terminal-spinner-line'
import type { MobileChatPermission } from './mobile-native-chat-permission'
import { terminalDialogKind, type TerminalDialogKind } from './mobile-native-chat-dialog-guard'
import { isCodexTerminalLocked } from './codex-terminal-lock'

const HUD_POLL_MS = 5_000

/**
 * While chat covers a terminal, read its screen for live controls and queued
 * messages: once per second while active, every five seconds while idle.
 *
 * Why polling `terminal.read`: chat pauses the terminal stream, the hook report
 * has no effort, and the host's mobile allowlist exposes no transcript read.
 * A screen read is cheap (one bounded RPC) and is exactly what the user sees.
 */
export function useMobileTerminalHudObservation(args: {
  client: RpcClient | null
  enabled: boolean
  handleRef: MutableRefObject<string | null>
  /** Changes whenever the active terminal changes; restarts the poll. */
  handleKey: string | null
  /** Codex states model/effort/mode differently and its host agent-status is
   *  mislabelled 'claude', so a codex tab must parse only the Codex footer —
   *  never the Claude bracket badge, which would leak a Claude model onto it. */
  active?: boolean
  agent?: string | null
}): {
  permissionDismissed: boolean
  queuedMessages: string[]
  /** Prompts the agent has already accepted, read off its scrollback. */
  sentPrompts: string[]
  /** Photos Claude painted above an accepted prompt, which the transcript
   *  the phone reads has lost (`mobile-terminal-sent-photos.ts`). */
  sentPhotos: ScreenSentPhotos[]
  /** Background-task completions the agent has stated on its scrollback,
   *  as this read saw them (`mobile-terminal-task-completions.ts`). Null
   *  until the first read of this terminal since the chat began watching it,
   *  and while it is not watching: an unread screen is not one without rows,
   *  and read as one it made a row still on screen look like it had left
   *  (use-active-tab-screen-completions.ts). */
  taskCompletions: ScreenTaskCompletion[] | null
  /** The peer-message rows on its scrollback, one per row, as this read saw
   *  them (`mobile-terminal-peer-notices.ts`). Null until the first read
   *  since the chat began watching this screen: the rows that read finds
   *  were painted before it looked (use-screen-peer-notices.ts). */
  peerNotices: ScreenPeerRow[] | null
  /** Claude Code's spinner line as this read saw it, or null when none is up. */
  spinner: ClaudeSpinner | null
  observation: TerminalHudObservation | null
  /** Re-read the screen now; resolves with what it saw (null on failure). */
  refresh: () => Promise<TerminalHudObservation | null>
  /** Claude Code's permission dialog options as drawn on screen, or null. */
  dialogOptions: MobileChatPermission['options'] | null
  /** A dialog that takes keys as answers is up, and what it asks for, by the
   *  one test the sends, the queue edit, the waiting notice and the draft
   *  mirror all use. */
  dialogKind: TerminalDialogKind | null
  /** True from `rereadAfterAnswer` until a read begun after it lands:
   *  `dialogKind` is then a screen from before the agent took the phone's
   *  answer, and the dialog on it is most likely the one that answer closed. */
  dialogBeforeAnswer: boolean
  /** The card the phone answered has left (use-answered-prompt-notice-hold.ts):
   *  read the screen again now, and flag `dialogKind` as older than that until
   *  the read is done. */
  rereadAfterAnswer: () => void
  terminalPermission: MobileChatPermission | null
} {
  const { client, enabled, handleRef, handleKey, agent } = args
  const queueScopeRef = useRef<string | null>(null)
  const [permissionDismissed, setPermissionDismissed] = useState(false)
  const [queuedMessages, setQueuedMessages] = useState<string[]>([])
  const [sentPrompts, setSentPrompts] = useState<string[]>([])
  const [sentPhotos, setSentPhotos] = useState<ScreenSentPhotos[]>([])
  // Tagged with the terminal it was read from, so a new terminal's rows are
  // unread until its own first read lands.
  const [taskCompletions, setTaskCompletions] = useState<{ handleKey: string; rows: ScreenTaskCompletion[] } | null>(null)
  const [peerNotices, setPeerNotices] = useState<ScreenPeerRow[] | null>(null)
  const [spinner, setSpinner] = useState<ClaudeSpinner | null>(null)
  const [observation, setObservation] = useState<TerminalHudObservation | null>(null)
  const [dialogOptions, setDialogOptions] = useState<MobileChatPermission['options'] | null>(null)
  const [dialogKind, setDialogKind] = useState<TerminalDialogKind | null>(null)
  const [dialogBeforeAnswer, setDialogBeforeAnswer] = useState(false)
  // Bumped by each `rereadAfterAnswer`; a read clears `dialogBeforeAnswer` only
  // if none came in while it was on the wire.
  const answersRef = useRef(0)
  const [terminalPermission, setTerminalPermission] = useState<MobileChatPermission | null>(null)
  const readRef = useRef<() => Promise<TerminalHudObservation | null>>(async () => null)

  useEffect(() => {
    setPermissionDismissed(false)
    setQueuedMessages((current) => (current.length ? [] : current))
    setTaskCompletions(null)
    setObservation(null)
    setSpinner(null)
    setDialogOptions(null)
    setDialogKind(null)
    setDialogBeforeAnswer(false)
    setTerminalPermission(null)
    if (!client || !enabled || !handleKey) {
      return
    }
    let sawPermission = false
    let active = true
    let inFlight = false
    const read = async (): Promise<TerminalHudObservation | null> => {
      const handle = handleRef.current
      if (!handle || inFlight) {
        return null
      }
      // A composed write sequence (the queue editor) is reading this same
      // screen as fast as the link allows. A poll on top of it competes for the
      // connection and slows the save it is trying to watch. Only while it is
      // actually driving the terminal, never while its sheet merely sits open.
      // Nor while one of the phone's own Codex drivers (a model or effort pick,
      // the /status poll) holds the terminal: the picker it opens is its own
      // work in progress, and read here it raised a notice about the phone's
      // own menu (independent review, 2026-09-27).
      if (isMobileNativeChatTerminalBurstActive(handle) || isCodexTerminalLocked(handle)) {
        return null
      }
      inFlight = true
      const answersBefore = answersRef.current
      try {
        const response = await client.sendRequest(
          'terminal.read',
          {
            terminal: handle,
            screen: true
          },
          { timeoutMs: 2500, budgetSpansConnect: true }
        )
        if (!active || handle !== handleRef.current || !response.ok) {
          return null
        }
        const terminal = (response as RpcSuccess).result as {
          terminal?: { tail?: unknown; lines?: unknown; source?: string; draft?: unknown }
        }
        // Stream fallback contains old repaints, not the current queue or dialog.
        if (terminal.terminal?.source && terminal.terminal.source !== 'screen') {
          return null
        }
        const raw = terminal.terminal?.tail ?? terminal.terminal?.lines
        const lines = Array.isArray(raw)
          ? raw.filter((line): line is string => typeof line === 'string')
          : []
        const permission =
          agent === 'codex'
            ? codexPermissionFromScreen(lines)
            : agent === 'claude' || agent === 'openclaude'
              ? claudePermissionFromScreen(lines)
              : null
        const queued =
          agent === 'codex'
            ? codexQueuedMessagesFromScreen(lines)
            : agent === 'claude' || agent === 'openclaude'
              ? queuedMessagesFromScreen(lines, terminal.terminal?.draft)
              : []
        queueScopeRef.current = handleKey
        setQueuedMessages((current) =>
          JSON.stringify(current) === JSON.stringify(queued) ? current : queued
        )
        // Only Claude paints its accepted prompts this way; Codex does not.
        // The reader takes the `❯` row and nothing under it — see
        // mobile-terminal-single-row-prompts.test.ts for why.
        const sent =
          agent === 'claude' || agent === 'openclaude' ? sentPromptsFromScreen(lines) : []
        setSentPrompts((current) =>
          JSON.stringify(current) === JSON.stringify(sent) ? current : sent
        )
        // Claude paints a landed task notification the same way; Codex has
        // no background tasks the phone lists.
        const completions =
          agent === 'claude' || agent === 'openclaude' ? taskCompletionsFromScreen(lines) : []
        setTaskCompletions((current) =>
          current?.handleKey === handleKey && JSON.stringify(current.rows) === JSON.stringify(completions)
            ? current
            : { handleKey, rows: completions }
        )
        const photos = agent === 'claude' || agent === 'openclaude' ? sentPhotosFromScreen(lines) : []
        setSentPhotos((current) => (JSON.stringify(current) === JSON.stringify(photos) ? current : photos))
        const peers = agent === 'claude' || agent === 'openclaude' ? peerNoticesFromScreen(lines, terminal.terminal?.draft) : []
        setPeerNotices((current) => (current !== null && JSON.stringify(current) === JSON.stringify(peers) ? current : peers))
        const painted = agent === 'claude' || agent === 'openclaude' ? parseClaudeSpinnerLine(lines) : null
        setSpinner((current) => (sameSpinner(current, painted) ? current : painted))
        const dialog = permission?.options ?? permissionOptionsFromScreen(lines)
        // The screen parser names only Claude's Bash dialog, so tracking
        // dismissal by it alone meant an Edit or MCP approval was never seen
        // leaving the screen and its card stayed, digits and all, for the whole
        // tool run. The numbered options are drawn by every dialog, so their
        // presence is the honest "a prompt is on screen" signal.
        if (permission || dialog) {
          sawPermission = true
          setPermissionDismissed(false)
        } else if (sawPermission) {
          setPermissionDismissed(true)
        }
        setTerminalPermission((current) =>
          JSON.stringify(current) === JSON.stringify(permission) ? current : permission
        )
        setDialogOptions((current) =>
          JSON.stringify(current) === JSON.stringify(dialog) ? current : dialog
        )
        setDialogKind(terminalDialogKind(lines, agent))
        if (answersRef.current === answersBefore) {
          setDialogBeforeAnswer(false)
        }
        const next =
          agent === 'codex' ? parseCodexHudObservation(lines) : parseTerminalHudObservation(lines)
        if (next) {
          // The whole observation, like the reads above. A hand-picked list of
          // six fields kept the old object when only the Codex mode or Claude's
          // shell count changed, so the mode pill and the task row went stale
          // (review, 2026-09-30).
          setObservation((current) =>
            JSON.stringify(current) === JSON.stringify(next) ? current : next
          )
        }
        return next
      } catch {
        // A failed screen read just leaves the last observation in place.
        return null
      } finally {
        inFlight = false
      }
    }
    readRef.current = read
    void read()
    return () => {
      active = false
      readRef.current = async () => null
      // Not read again until the next watch's first read, which finds what
      // was painted meanwhile rather than watching it arrive.
      setPeerNotices(null)
    }
  }, [agent, client, enabled, handleKey, handleRef])

  // Activity changes the cadence, not the observed session. Resetting the read
  // effect here made approval cards disappear and reappear on status updates.
  useEffect(() => {
    if (!client || !enabled || !handleKey) {
      return
    }
    const timer = setInterval(() => void readRef.current(), args.active ? 1000 : HUD_POLL_MS)
    return () => clearInterval(timer)
  }, [args.active, client, enabled, handleKey])

  // Why: a Shift+Tab from the phone changes the footer at once; waiting up to
  // 5s for the next poll would make the mode pill look stuck.
  const refresh = useCallback(() => readRef.current(), [])
  // Why: the phone's answer closes the dialog the last read saw, and the poll
  // comes once a second. The waiting notice read that dialog as still up once
  // the card had gone, and drew "A menu is open in the terminal" between the
  // card leaving and the next poll (2026-09-29, "the screen flashes").
  const rereadAfterAnswer = useCallback(() => {
    answersRef.current += 1
    setDialogBeforeAnswer(true)
    void readRef.current()
  }, [])

  return {
    observation,
    refresh,
    dialogOptions,
    dialogKind,
    dialogBeforeAnswer,
    rereadAfterAnswer,
    terminalPermission,
    queuedMessages: enabled && queueScopeRef.current === handleKey ? queuedMessages : [],
    sentPrompts: enabled && queueScopeRef.current === handleKey ? sentPrompts : [],
    sentPhotos: enabled && queueScopeRef.current === handleKey ? sentPhotos : [],
    taskCompletions: enabled && taskCompletions?.handleKey === handleKey ? taskCompletions.rows : null,
    peerNotices: enabled && queueScopeRef.current === handleKey ? peerNotices : null,
    spinner: enabled && queueScopeRef.current === handleKey ? spinner : null,
    permissionDismissed
  }
}
