import type { RpcClient } from '../transport/rpc-client'
import type { BeaconPromptReceipt } from './mobile-native-chat-beacon-confirm'
import { buildMobileNativeChatClearInputForText } from './mobile-native-chat-input-clear'
import {
  clearMobileNativeChatInput,
  sendMobileNativeChatMessageWithOutcome,
  typeMobileNativeChatCommandWithOutcome,
  type MobileNativeChatSendOutcome
} from './mobile-native-chat-send'
import { clearMobileNativeChatInputResidue } from './mobile-native-chat-stale-input'
import {
  chipOnlyRows,
  claudeInputHoldsExactly,
  receiptCarriesWords,
  verifyClaudeSubmit,
  type SubmitVerdict
} from './mobile-native-chat-submit-verify'
import { STATUS_PROMPT_NONCE_PREFIX } from './agent-status-prompts'
import { terminalDialogOnScreen } from './mobile-native-chat-dialog-guard'
import {
  acquireMobileNativeChatTerminalWrite,
  mobileNativeChatTerminalWriteOwner,
  releaseMobileNativeChatTerminalWrite,
  releaseMobileNativeChatTerminalWriteForSend
} from './mobile-native-chat-terminal-write-lock'
import { timeSendStage } from './native-chat-send-timing'
import { claudeSentBashTexts, claudeSentPromptTexts } from './claude-composer-screen'
import { readMobileNativeChatScreen } from './mobile-native-chat-screen-read'
import { MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS } from './mobile-native-chat-send'
import { shellCommandOfSend } from './mobile-native-chat-shell-command'
import {
  clearClaudeInputVerified,
  INPUT_STILL_HOLDS_TEXT
} from './mobile-native-chat-verified-clear'

/**
 * What a chat send does to the agent's input: clear it, type the body, and for
 * Claude Code check that the agent took it.
 *
 * Claude Code turns a control byte into its own key only when the whole stdin
 * READ is under 64 bytes (2.1.286 and 2.1.287 input tokenizer). The limit is per
 * read, not per write, and separate `terminal.send` writes made back to back
 * arrive as one read. So no write size is safe by counting, and a host ack
 * ("accepted") says the bytes were written, never that they were understood
 * (2026-10-01: a message went out as itself, 33 newlines and itself again, and
 * Claude declined to submit it). Claude's clear is sized from the screen and read
 * back before the body; its send stays pending until the agent's own prompt copy
 * says it took the words (the screen alone only for a `!` command or words the tab
 * status cannot repeat: chatSendOutcomeOfVerdict). Codex keeps the burst it always had: the
 * 64-byte rule is Claude Code's.
 *
 * Limits. The clear is two passes of at most 16 rows (about 31 rows of input);
 * a longer draft, such as a 6,000-character one mirrored onto an 80-column desk,
 * is refused with "The desktop input still holds text. Clear it there, then send
 * again." and stays in the composer. Main glued such a draft; this refuses it.
 * Text the clear cannot reach at all (a placeholder such as Claude's prompt
 * suggestion) is not a refusal: the send goes on, unverified. Only Claude's own
 * review notice proves a send did not go; the words still in the input are held
 * for the transcript, never restored, since the Enter can simply be late.
 *
 * A transcript row of `message + newlines + message` would not retire the chat's
 * own copy by text, one more reason "sent" has to come from that check.
 */
export type ChatSendWrite =
  /** Nothing was submitted and the draft goes back to the composer. */
  { kind: 'stopped'; message: string } | { kind: 'written'; outcome: MobileNativeChatSendOutcome }

type MobileClient = { id: string; type: 'mobile' }

/** A clear that did not go: the caller says why when its budget is the reason
 *  (spentSendBudgetRefusal), and this bare word otherwise. */
export const CLEAR_NOT_WRITTEN = 'Message not sent'

async function clearInputForSend(args: {
  agent: string | null
  client: RpcClient
  terminal: string
  believedTexts: readonly [string | null | undefined, string | null, string]
  deadline: number
  mobileClient?: MobileClient
}): Promise<{ message: string } | null> {
  const { agent, believedTexts, ...common } = args
  if (agent === 'claude') {
    const result = await clearClaudeInputVerified({ ...common, believedTexts })
    if (result === 'still-holds') {
      // Typing on top of text the phone could not remove is how a message
      // arrives glued to its own copy.
      return { message: INPUT_STILL_HOLDS_TEXT }
    }
    if (result === 'write-failed') {
      return { message: CLEAR_NOT_WRITTEN }
    }
  } else if (
    !(await clearMobileNativeChatInput({
      ...common,
      clearInput: buildMobileNativeChatClearInputForText(...believedTexts)
    }))
  ) {
    return { message: CLEAR_NOT_WRITTEN }
  }
  clearMobileNativeChatInputResidue(args.terminal)
  return null
}

/**
 * Whether a Claude send counts as delivered: only on Claude's own record of it.
 *
 * On 2026-10-11 (0.9.128) "Is all of asks done", sent while Claude worked, was drawn as sent and
 * never reached Claude: not in its input (Orca's terminal-history log of the tab), not in its
 * transcript, no queue-operation. The check had called it sent on the phone's own reading: no
 * look at all (`unverified`), or the words leaving the input. Claude's record, as the phone reads
 * it, is:
 *  - its prompt copy (the hook beacon's `up=`, or the prompt Orca's own UserPromptSubmit hook puts
 *    on the tab status, which a hand-started session has too; it fires at the enqueue mid-turn,
 *    2.1.284, desk-prompt-row-owners.ts);
 *  - the prompt drawn above its box, which only Claude draws: in the conversation or in its queue
 *    box (the same column-zero `❯ ` row since 2.1.277), a new `! cmd` row, a new chips-only row;
 *  - later, its transcript row.
 * Anything less goes back as `unknown`: held for the copy or the row, as an ack that never came is,
 * and seen through by the outbox (sent again once the agent is idle) when neither comes. The bubble
 * looks the same either way (MobileNativeChatOutboxStatus.tsx draws nothing while a send is on its
 * way).
 *
 * The words leaving the input with nothing drawn (`inputOnly`) still stand in one case, where no
 * copy can come to settle a hold and holding would only get them typed twice: the same words as
 * the last status copy on a tab with no beacon (no beacon copy, and no status copy twinned with
 * one): the tab status repeats no prompt it already holds (agent-status-prompts.ts
 * `text === state.last`), while the beacon gives each submission its own copy. An empty list of
 * copies is NOT read as a tab with no hook (Opus re-review of 05dd008f6): a fresh session, a
 * `/clear`, or the outbox's own resend (which reads none) has none either, and Orca installs its
 * hook for every session. On a tab that truly has no hook, a held mid-turn message Claude took
 * with nothing drawn can be typed again after the turn: a duplicate, never a loss.
 * A `!` shell command keeps the rule it had (its `! cmd` row; no hook; `unverified` stands): a hold
 * would end with the outbox running it again, since the drainer reads its row as no landing.
 *
 * KNOWN LIMIT: a prompt drawn above has no baseline, so an EARLIER row of the same words still on
 * screen passes for this send's (claudeSentPromptTexts says so): repeating a message still in view
 * can be called delivered before the second one landed. A row must hold the words whole, or be a
 * start of them at least 40 characters long (a queue row Claude cut); an earlier row that only
 * shares the first 40 characters and then differs does not pass (verifyClaudeSubmit).
 */
export function chatSendOutcomeOfVerdict(
  verdict: Exclude<SubmitVerdict, { kind: 'not-sent' }>,
  text: string,
  receiptsBefore: readonly BeaconPromptReceipt[]
): MobileNativeChatSendOutcome {
  if (shellCommandOfSend(text, 'claude') !== null) {
    return verdict.kind === 'unknown' ? 'unknown' : 'accepted'
  }
  if (verdict.kind !== 'sent') {
    return 'unknown'
  }
  if (verdict.byReceipt || !verdict.inputOnly) {
    return 'accepted'
  }
  // The merge folds a beacon copy into its status twin (desktop-prompt-merge.ts), so a beacon tab
  // shows as twinned status copies as often as beacon nonces.
  const beaconTab = receiptsBefore.some(
    (receipt) => !receipt.nonce.startsWith(STATUS_PROMPT_NONCE_PREFIX) || receipt.hookTwin !== undefined
  )
  const lastStatusCopy = receiptsBefore.findLast((receipt) => receipt.nonce.startsWith(STATUS_PROMPT_NONCE_PREFIX))
  return !beaconTab && lastStatusCopy !== undefined && receiptCarriesWords(lastStatusCopy, text) ? 'accepted' : 'unknown'
}

/** How long the second Return and its check may take, past whatever the send's budget has left. */
const SECOND_RETURN_BUDGET_MS = MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS + 4_500
/** The two looks before a second Return are this far apart: one look can catch a frame mid-draw,
 *  or a draft Orca is about to replace. */
const SECOND_RETURN_LOOK_GAP_MS = 600

/**
 * The words are still in Claude's input at the end of the check: the Return never submitted
 * them. Claude Code drops a Return that arrives while it is still reading a pasted image, and
 * the end of that read clears the dropped Return without submitting (2.1.288, see
 * mobile-native-chat-image-send-settle.ts). On 0.9.128 such a photo send sat on the desk's input
 * line, the phone said "Delivery unconfirmed" and gave it up (2026-10-11: Image #57 pasted and
 * never sent, its chip and bubble left on the phone). One more Return, alone, submits them.
 *
 * It goes only when it can only submit these words (Opus review of 7872fddf2): holding the
 * terminal's write lock (so the draft mirror and a card answer stand aside), and only after two
 * looks, SECOND_RETURN_LOOK_GAP_MS apart, each showing no dialog and the input holding exactly
 * this send's words (claudeInputHoldsExactly). A dialog would take the Return as its answer; words
 * typed after the send would be submitted glued to these. Anything less and it is not pressed:
 * the send is held, and the outbox drainer clears and types it again once the agent is idle.
 * What remains, not closed: the first Return landing in the instant between the last look and
 * this one, and a draft-mirror batch queued just before the lock was taken landing after the
 * last look (one write round trip). Either way this Return reaches an input the looks did not
 * see. What a Return on an empty box does is not verified: docs/mobile-background-tasks.md says
 * it submits a prompt suggestion Claude draws at a turn's end, and nothing here has observed it
 * with messages queued.
 */
async function pressReturnAgain(args: {
  client: RpcClient
  terminal: string
  text: string
  hasImages: boolean
  deadline: number
  mobileClient?: MobileClient
  receipts: () => readonly BeaconPromptReceipt[]
  sendId?: string
  seenNonces: ReadonlySet<string>
  receiptsBefore: readonly BeaconPromptReceipt[]
  priorBashRows: readonly string[] | null
  priorChipRows: number | null
}): Promise<ChatSendWrite> {
  const held: ChatSendWrite = { kind: 'written', outcome: 'unknown' }
  if (!acquireMobileNativeChatTerminalWrite(args.terminal)) {
    return held
  }
  const owner = mobileNativeChatTerminalWriteOwner(args.terminal)
  try {
    const deadline = Math.max(args.deadline, Date.now() + SECOND_RETURN_BUDGET_MS)
    for (let look = 0; look < 2; look += 1) {
      if (look > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, SECOND_RETURN_LOOK_GAP_MS))
      }
      const screen = await readMobileNativeChatScreen({ client: args.client, terminal: args.terminal, deadline })
      if (
        !screen ||
        terminalDialogOnScreen(screen.lines, 'claude') ||
        !claudeInputHoldsExactly(screen, args.text, args.hasImages)
      ) {
        return held
      }
    }
    const pressed = await sendMobileNativeChatMessageWithOutcome({
      client: args.client,
      terminal: args.terminal,
      text: '',
      enter: true,
      deadline,
      ...(args.mobileClient ? { mobileClient: args.mobileClient } : {})
    })
    // From here the send only reads: the terminal goes back, so a permission tap or a pick during
    // the check is not refused (the same release writeChatSend makes after the body).
    releaseMobileNativeChatTerminalWrite(args.terminal, owner)
    if (pressed !== 'accepted') {
      return held
    }
    const again = await verifyClaudeSubmit({
      client: args.client,
      terminal: args.terminal,
      text: args.text,
      images: args.hasImages,
      receipts: args.receipts,
      seenNonces: args.seenNonces,
      ...(args.sendId ? { sendId: args.sendId } : {}),
      priorBashRows: args.priorBashRows,
      priorChipRows: args.priorChipRows,
      wordsSeenInInput: true,
      deadline
    })
    if (again.kind === 'not-sent') {
      return { kind: 'stopped', message: again.message }
    }
    return { kind: 'written', outcome: chatSendOutcomeOfVerdict(again, args.text, args.receiptsBefore) }
  } finally {
    releaseMobileNativeChatTerminalWrite(args.terminal, owner)
  }
}

async function readBashRows(
  client: RpcClient,
  terminal: string,
  deadline: number
): Promise<string[] | null> {
  const screen = await readMobileNativeChatScreen({ client, terminal, deadline })
  return screen ? claudeSentBashTexts(screen.lines) : null
}

async function readChipRows(client: RpcClient, terminal: string, deadline: number): Promise<number | null> {
  const screen = await readMobileNativeChatScreen({ client, terminal, deadline })
  return screen ? chipOnlyRows(claudeSentPromptTexts(screen.lines)) : null
}

export async function writeChatSend(args: {
  agent: string | null
  client: RpcClient
  terminal: string
  text: string
  /** The send carries pasted images: no clear (the paste ahead of it did that), but the
   *  submit is checked like a text send's, with the `[Image #N]` chips set aside
   *  (verifyClaudeSubmit `images`). Codex has no such check, for photos or text. */
  hasImages: boolean
  /** A composer send, as against an answer to a question or a command pick. */
  syncComposer: boolean
  classification: 'chat' | 'command' | string
  typesCodexCommand: boolean
  /** Launch-context text Orca parked on the line, and what a queue edit left. */
  seed: { text: string; createdAt: number | null } | null
  residue: string | null
  deadline: number
  deviceToken: string | null
  /** The agent's prompt copies as they are now. */
  receipts: () => readonly BeaconPromptReceipt[]
  /** The send's one id (its outbox entry's), which Claude's check keys its copy by (S1). */
  sendId?: string
  /** The desktop answered the body write: the phone's ack, where a bubble's dim ends (S2). Called
   *  before Claude's check, which can take seconds and still not settle. */
  onBodyAcked?: () => void
}): Promise<ChatSendWrite> {
  const { agent, client, terminal, text, deadline } = args
  const mobileClient = args.deviceToken
    ? { id: args.deviceToken, type: 'mobile' as const }
    : undefined
  const resolvedLaunchDraft =
    args.syncComposer && typeof args.seed?.createdAt === 'number'
      ? { text: args.seed.text, createdAt: args.seed.createdAt }
      : undefined
  // Keep terminal controls in their own write. When bundled with the body, a
  // pasted burst can become literal prompt text instead of editing the input.
  if (!args.hasImages && (args.seed || !args.typesCodexCommand)) {
    const refused = await clearInputForSend({
      agent,
      client,
      terminal,
      believedTexts: [args.seed?.text, args.residue, text],
      deadline,
      ...(mobileClient ? { mobileClient } : {})
    })
    if (refused) {
      return { kind: 'stopped', message: refused.message }
    }
  }
  // Copies the beacon already holds: an older identical prompt proves nothing.
  const receiptsBefore = args.receipts()
  const seenNonces = new Set(receiptsBefore.map((receipt) => receipt.nonce))
  // A Claude shell command's echo is a `! cmd` row in the scrollback, which keeps every one ever
  // run: the rows there now are the baseline a repeat has to exceed (verifyClaudeSubmit). Only
  // Claude's check uses it. The look is cut so the body keeps what it needs
  // (MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS): it may not be the read that makes the body refuse
  // after the clear went out. No baseline, and the echo row proves nothing (`null`).
  const priorBashRows =
    agent !== 'claude' || shellCommandOfSend(text, agent) === null
      ? []
      : await readBashRows(client, terminal, deadline - MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS)
  // A photo with no caption has no words to find drawn above the box: its row is one more
  // chips-only row than the screen held before (verifyClaudeSubmit `priorChipRows`), so a
  // mid-turn photo Claude queued is told by Claude's own row, not held and pasted again.
  const priorChipRows =
    agent === 'claude' && args.hasImages && text.trim() === ''
      ? await readChipRows(client, terminal, deadline - MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS)
      : null
  const outcome = args.typesCodexCommand
    ? await typeMobileNativeChatCommandWithOutcome({
        client,
        terminal,
        command: text,
        ...(resolvedLaunchDraft ? { resolvedLaunchDraft } : {}),
        ...(mobileClient ? { mobileClient } : {}),
        deadline
      })
    : await sendMobileNativeChatMessageWithOutcome({
        client,
        terminal,
        text,
        ...(agent === 'codex' && args.syncComposer && args.classification === 'chat'
          ? { queueWithTab: true }
          : {}),
        ...(resolvedLaunchDraft ? { resolvedLaunchDraft } : {}),
        deadline,
        ...(mobileClient ? { mobileClient } : {})
      })
  if (outcome === 'accepted') {
    args.onBodyAcked?.()
  }
  if (
    outcome !== 'accepted' ||
    agent !== 'claude' ||
    !args.syncComposer ||
    args.classification !== 'chat'
  ) {
    return { kind: 'written', outcome }
  }
  // The body and its Enter are written: from here the send only reads. Let the
  // caller's write lock go, so a permission tap or a picker pick during the check
  // is not refused with "Another input is still being sent". Only a lock the caller
  // took for this send, and still holds (its own release then finds nothing to
  // undo): never another sequence's on whatever terminal the send resolved.
  releaseMobileNativeChatTerminalWriteForSend(terminal)
  const verdict = await timeSendStage('verify', () => verifyClaudeSubmit({
    client,
    terminal,
    text,
    images: args.hasImages,
    receipts: args.receipts,
    seenNonces,
    ...(args.sendId ? { sendId: args.sendId } : {}),
    priorBashRows,
    priorChipRows,
    deadline
  }))
  if (verdict.kind === 'not-sent') {
    // Claude asked the user to review it: nothing more is typed or submitted.
    return { kind: 'stopped', message: verdict.message }
  }
  if (verdict.kind === 'unknown' && verdict.stillTyped) {
    return pressReturnAgain({ ...args, ...(mobileClient ? { mobileClient } : {}), seenNonces, receiptsBefore, priorBashRows, priorChipRows })
  }
  // Delivered only on Claude's own record (chatSendOutcomeOfVerdict). Anything less, the looks
  // settling nothing (`unknown`), no look at all (`unverified`) or a screen that only seemed to say
  // so, is held for the transcript or a prompt copy like an ack that never came.
  return { kind: 'written', outcome: chatSendOutcomeOfVerdict(verdict, text, receiptsBefore) }
}
