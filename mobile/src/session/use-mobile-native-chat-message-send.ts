import { useCallback, useRef, type MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import {
  openMobileNativeChatSendBudget,
  type MobileNativeChatSendOutcome
} from './mobile-native-chat-send'
import type { PickDispatch, PickDispatchOptions } from './session-option-pick-failure'
import { isSlashCommandDraft } from '../../../src/shared/native-chat-slash-commands'
import { healMobileNativeChatStaleInput } from './mobile-native-chat-stale-input'
import { classifyMobileNativeChatSend } from './mobile-native-chat-send-classification'
import {
  acquireMobileNativeChatTerminalWrite,
  releaseMobileNativeChatTerminalWrite
} from './mobile-native-chat-terminal-write-lock'
import type { MobileNativeChatSendOrigin } from './use-mobile-native-chat-drafts'
import type { MobileNativeChatLaunchDraftSeed } from './use-mobile-native-chat-launch-draft-seed'
import { mobileNativeChatInputResidue } from './mobile-native-chat-stale-input'
import { useMobileNativeChatSendGate } from './mobile-native-chat-send-readiness'
import { COMMAND_UNCONFIRMED, typeCodexChatCommand } from './mobile-native-chat-codex-command'
import { unconfirmedChatSendNotice } from './mobile-native-chat-shell-command'
import { readSendUnderDialogRefusal, refusedUnderDialog } from './mobile-native-chat-dialog-guard'
import { notePhoneTerminalSend } from './native-chat-kept-session-state'
import { writeChatSend } from './mobile-native-chat-send-write'
import type { BeaconPromptReceipt } from './mobile-native-chat-beacon-confirm'
import type { MobileNativeChatSendFollow } from './mobile-native-chat-send-follow'

const NO_RECEIPTS: readonly BeaconPromptReceipt[] = []


export type MobileNativeChatMessageSend = {
  /** Composer send that syncs the draft (clear on send, restore on rejection). */
  send: (text: string, images?: string[]) => Promise<boolean>
  /** Outcome-preserving variant: callers that pasted terminal input beforehand
   *  (image sends) must see 'unknown' to heal a possibly-orphaned paste. Such a
   *  caller passes its own `deadline` so the paste it already spent and this text
   *  body share one budget instead of holding the composer for two. */
  sendWithOutcome: (
    text: string,
    images?: string[],
    deadline?: number,
    follow?: MobileNativeChatSendFollow
  ) => Promise<MobileNativeChatSendOutcome>
  /** Answer to an agent question — never touches the composer draft. */
  answerQuestion: (text: string) => Promise<boolean>
  /** Session-option command dispatch (e.g. `/model sonnet`) — never touches the
   *  composer draft; callers need the outcome to track dispatched state. A
   *  refusal is said through `options.onError` when the pick brought one. */
  dispatchCommand: PickDispatch
}

/** The native-chat send seam: one write path shared by composer sends, image
 *  sends, and question answers, wired to the drafts accounting. */
export function useMobileNativeChatMessageSend(args: {
  client: RpcClient | null
  enabled: boolean
  handleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  /** Active tab's agent — classification is per-agent (command catalogs differ). */
  agentRef: MutableRefObject<string | null>
  /** Captured when a control send starts so a later tab switch cannot record its
   *  session-option effects against the newly active tab. */
  commandSendRef: MutableRefObject<(command: string) => void>
  captureSendOrigin: (text: string) => MobileNativeChatSendOrigin | null
  /** Launch-context text Orca parked on the agent's TUI input line, or null. Read
   *  at send time so the pre-clear can be sized to every line it occupies. */
  readSeededLaunchDraftSeed: () => MobileNativeChatLaunchDraftSeed | null
  clearDraftForSend: (origin: MobileNativeChatSendOrigin, text: string) => void
  restoreRejectedDraft: (origin: MobileNativeChatSendOrigin, text: string) => void
  acceptSend: (origin: MobileNativeChatSendOrigin, text: string, images?: string[]) => void
  holdUnconfirmedSend: (
    origin: MobileNativeChatSendOrigin,
    text: string,
    onUnconfirmed: () => void
  ) => void
  onSendError: (message: string) => void
  /** Runs before any bytes go out on a composer send. The draft mirror uses it
   *  to drain in-flight keystroke echoes and forget them, so the send's own
   *  clear + body is not interleaved with, or later "corrected" against, them. */
  beforeSend?: () => Promise<void>
  /** A composer-originated slash/skill send was accepted by the TUI. The result
   *  renders in the terminal, not the transcript, so the caller can surface it. */
  onCommandDispatched?: (command: string) => void
  /** The look at the screen before an answer or a pick types (the screen read
   *  by default; mobile-native-chat-dialog-guard.ts). */
  refuseUnderDialog?: typeof readSendUnderDialogRefusal
  /** The agent's own prompt copies (the hook beacon's `up=`). A copy that
   *  carries a send's words proves Claude took it. */
  promptReceipts?: readonly BeaconPromptReceipt[]
}): MobileNativeChatMessageSend {
  const {
    client,
    enabled,
    handleRef,
    deviceTokenRef,
    agentRef,
    commandSendRef,
    captureSendOrigin,
    readSeededLaunchDraftSeed,
    clearDraftForSend,
    restoreRejectedDraft,
    acceptSend,
    holdUnconfirmedSend,
    onSendError,
    beforeSend,
    onCommandDispatched,
    refuseUnderDialog = readSendUnderDialogRefusal,
    promptReceipts = NO_RECEIPTS
  } = args
  // Read when the send verifies, not as of the render it began in.
  const promptReceiptsRef = useRef(promptReceipts)
  promptReceiptsRef.current = promptReceipts
  const sendGate = useMobileNativeChatSendGate({
    client,
    sendable: enabled,
    action: 'Message',
    onUnready: onSendError
  })

  const sendMessage = useCallback(
    async (
      draftText: string,
      images: string[] | undefined,
      syncComposer: boolean,
      recordControlSend: boolean,
      sharedDeadline?: number,
      report: (message: string) => void = onSendError,
      follow?: MobileNativeChatSendFollow
    ): Promise<MobileNativeChatSendOutcome> => {
      // The host writes trailing whitespace verbatim onto the agent's input line,
      // where it can glue the next rapid send onto this one (#14262). Only the
      // bytes that go out are trimmed: `draftText` is what the user typed, and a
      // rejected send has to put back exactly that (#14819).
      const text = draftText.trimEnd()
      const handle = handleRef.current
      const origin = captureSendOrigin(text)
      const agent = agentRef.current
      const recordCommand = commandSendRef.current
      if (!handle || !origin) {
        report(handle ? 'Message not sent (no chat on this tab)' : 'Message not sent (no terminal on this tab)')
        return 'rejected'
      }
      // The image hook's send follows its TAB: a handle other than the one it
      // verified, before this wrote a byte, goes back to it unsent and unsaid
      // (`reminted`), and a switch to another tab says so below.
      const movedUnderSend = (): boolean => {
        if (!follow || handleRef.current === follow.terminal) {
          return false
        }
        if (follow.tabChanged()) {
          report('Message not sent (session changed)')
        } else {
          follow.reminted = true
        }
        return true
      }
      if (movedUnderSend()) {
        return 'rejected'
      }
      // One budget for the whole action, the wait for the link included: a hung
      // heal must eat into the text send's time, not hand it a fresh timeout and
      // pin the composer for twice as long. An image send already opened one
      // covering its paste — keep spending that.
      const deadline = sharedDeadline ?? openMobileNativeChatSendBudget()
      // Nothing has been written yet, so a composer send tapped while the relay
      // re-dials waits for it and then goes (mobile-native-chat-send-readiness.ts).
      // A card answer or a command does not: what it types was chosen against a
      // screen the phone has not seen since the link dropped.
      const client = syncComposer
        ? await sendGate.wait(deadline, follow ? follow.tabChanged : () => handleRef.current !== handle)
        : sendGate.now(recordControlSend ? 'Answer' : 'Command', report)
      if (!client || movedUnderSend()) {
        return 'rejected'
      }
      // An answer or a pick types text and an Enter, which a dialog on screen
      // takes as its answer (2026-09-27), and an agent that exited back to a shell
      // takes as a command to run (Claude 2026-10-02): the look also refuses a screen
      // with no input box of the agent's (readSendUnderDialogRefusal
      // `requireComposer`, for Claude and Codex; a screen the host cannot show, or
      // a read that fails on a host that has shown screens, refuses too, and an
      // older host's fails open, said there). A composer send through the image
      // hook looked already, before any paste, and its follow says so
      // (use-mobile-native-chat-image-attachments.ts). One that did not (a caller
      // with no hook) looks here when the agent is Claude or Codex.
      if (
        (!syncComposer || (!follow && (agent === 'claude' || agent === 'codex'))) &&
        (await refusedUnderDialog(
          refuseUnderDialog,
          { client, terminal: handle, deadline, agent, requireComposer: true },
          report
        ))
      ) {
        return 'rejected'
      }
      if (syncComposer && beforeSend) {
        await beforeSend()
      }
      // The agent's input may still hold an orphaned image paste from an earlier
      // send (#10228); submitting on top of it would glue the image onto this
      // message. Healed before the draft clear so a failed heal — which sends
      // nothing — leaves the composer exactly as the user left it.
      const healArgs = {
        client,
        terminal: handle,
        deviceToken: deviceTokenRef.current,
        deadline
      }
      if (!(await healMobileNativeChatStaleInput(healArgs))) {
        report('Message not sent')
        return 'rejected'
      }
      // Why: empty the composer at send time, not on the ack — over relay the
      // round trip is visible, and a lost ack must not strand the sent prompt
      // in the box. Only a definite rejection puts the text back.
      if (syncComposer) {
        clearDraftForSend(origin, draftText)
      }
      const seededLaunchDraft = readSeededLaunchDraftSeed()
      const classification = images?.length ? 'chat' : classifyMobileNativeChatSend(agent, text)
      const typesCodexCommand =
        agent === 'codex' &&
        classification !== 'chat' &&
        isSlashCommandDraft(text) &&
        !images?.length
      // Clear, body, and for Claude a check that it took the words. The limit
      // behind it is per stdin READ and writes coalesce, so the host's ack is not
      // proof (mobile-native-chat-send-write.ts).
      const written = await writeChatSend({
        agent,
        client,
        terminal: handle,
        text,
        hasImages: Boolean(images?.length),
        syncComposer,
        classification,
        typesCodexCommand,
        seed: seededLaunchDraft,
        residue: mobileNativeChatInputResidue(handle),
        deadline,
        deviceToken: deviceTokenRef.current,
        receipts: () => promptReceiptsRef.current
      })
      if (written.kind === 'stopped') {
        // Refused before the body, or Claude declined it. Nothing more is typed,
        // and Enter is not pressed again: Claude asked the user to review.
        if (syncComposer) {
          restoreRejectedDraft(origin, draftText)
        }
        report(written.message)
        return 'rejected'
      }
      const outcome = written.outcome
      if (outcome !== 'rejected') {
        // What this phone wrote to the terminal, for the chat's session rule
        // (native-chat-kept-session.ts `phoneOwnership`).
        notePhoneTerminalSend(handle, text, Date.now())
      }
      // Why (desktop parity): a slash/skill send dispatches into the agent's own
      // TUI, not the conversation — the transcript never echoes it as a user
      // turn, so an optimistic bubble would never reconcile and the
      // unconfirmed hold could never observe a landing.
      if (outcome === 'unknown') {
        if (classification === 'chat') {
          // Why: an ack-lost send usually WAS delivered (issue seen on cellular
          // relay) — verify via the transcript echo instead of a false "not sent".
          holdUnconfirmedSend(origin, text, () => report(unconfirmedChatSendNotice(text, agent)))
        } else {
          // A command has no echo to wait for, so this is the only word it gets.
          report(COMMAND_UNCONFIRMED)
        }
        return 'unknown'
      }
      if (outcome === 'rejected') {
        if (syncComposer) {
          restoreRejectedDraft(origin, draftText)
        }
        report('Message not sent')
        return 'rejected'
      }
      if (classification === 'chat') {
        // `images` are local preview URIs for the optimistic echo — the actual
        // image bytes already rode along as a bracketed paste before this text
        // send. An image-carrying send already got its echo from the caller,
        // at the same moment the composer cleared (clearDraftAtSendStartWith),
        // so it is not repeated here — only a text-only send echoes at this point.
        if (!images?.length) {
          acceptSend(origin, text, images)
        }
      } else {
        if (recordControlSend) {
          // The session-option catalog can recognize controls omitted from the
          // autocomplete catalog (for example Claude `/model` and `/fast`).
          recordCommand(text.trim())
        }
        if (syncComposer) {
          onCommandDispatched?.(text.trim())
        }
      }
      return 'accepted'
    },
    [
      acceptSend,
      agentRef,
      beforeSend,
      captureSendOrigin,
      clearDraftForSend,
      commandSendRef,
      deviceTokenRef,
      handleRef,
      holdUnconfirmedSend,
      onCommandDispatched,
      onSendError,
      readSeededLaunchDraftSeed,
      refuseUnderDialog,
      restoreRejectedDraft,
      sendGate
    ]
  )

  const sendWithOutcome = useCallback(
    (text: string, images?: string[], deadline?: number, follow?: MobileNativeChatSendFollow) =>
      sendMessage(text, images, true, true, deadline, undefined, follow),
    [sendMessage]
  )

  // Boolean surface for callers with no pre-pasted input: 'unknown' stays true
  // (the send usually landed; the optimistic echo is already held unconfirmed).
  const send = useCallback(
    async (text: string, images?: string[]): Promise<boolean> =>
      (await sendWithOutcome(text, images)) !== 'rejected',
    [sendWithOutcome]
  )

  // A question answer is not composer text, so it never syncs the draft. It
  // reaches this send directly (not through the image hook's locked path), so
  // it takes the per-terminal write lock itself: an answer landing mid-flight
  // in an image paste sequence would interleave bytes into the PTY.
  const answerQuestion = useCallback(
    async (text: string): Promise<boolean> => {
      const terminal = handleRef.current
      if (terminal && !acquireMobileNativeChatTerminalWrite(terminal)) {
        onSendError('Answer not sent')
        return false
      }
      try {
        return (await sendMessage(text, undefined, false, true)) !== 'rejected'
      } finally {
        if (terminal) {
          releaseMobileNativeChatTerminalWrite(terminal)
        }
      }
    },
    [handleRef, onSendError, sendMessage]
  )

  // A session-option apply writes to the same input line as a send, and the host
  // spaces a send's body and its Enter ~500ms apart — so without this lock an
  // apply lands between them and is submitted as part of the user's prompt.
  // Every exit that is not the composer send's own says why: the picker stays
  // open on a false result with nothing else to tell the user (2026-09-25). A
  // pick from the open drawer brings its own reporter, because the chat's
  // banner draws under the drawer; anything else says it on that banner. The
  // send gate's refusal goes the same way.
  const dispatchCommand = useCallback(
    async (text: string, options?: PickDispatchOptions): Promise<MobileNativeChatSendOutcome> => {
      const report = options?.onError ?? onSendError
      const terminal = handleRef.current
      if (terminal && !acquireMobileNativeChatTerminalWrite(terminal)) {
        report('Another input is still being sent. Try again.')
        return 'rejected'
      }
      try {
        if (agentRef.current === 'codex') {
          if (!terminal) {
            report('Command not sent (no terminal on this tab)')
            return 'rejected'
          }
          // A command does not wait for the link: what it types was chosen
          // against a screen the phone has not seen since it dropped.
          const client = sendGate.now('Command', report)
          if (!client || (await refusedUnderDialog(refuseUnderDialog, { client, terminal, agent: 'codex' }, report))) {
            return 'rejected'
          }
          return await typeCodexChatCommand({
            client,
            terminal,
            command: text,
            deviceToken: deviceTokenRef.current,
            onSendError: report
          })
        }
        return await sendMessage(text, undefined, false, false, undefined, report)
      } finally {
        if (terminal) {
          releaseMobileNativeChatTerminalWrite(terminal)
        }
      }
    },
    [deviceTokenRef, handleRef, onSendError, refuseUnderDialog, sendGate, sendMessage]
  )

  return { send, sendWithOutcome, answerQuestion, dispatchCommand }
}
