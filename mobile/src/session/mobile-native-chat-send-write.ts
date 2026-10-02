import type { RpcClient } from '../transport/rpc-client'
import type { BeaconPromptReceipt } from './mobile-native-chat-beacon-confirm'
import { buildMobileNativeChatClearInputForText } from './mobile-native-chat-input-clear'
import {
  clearMobileNativeChatInput,
  sendMobileNativeChatMessageWithOutcome,
  typeMobileNativeChatCommandWithOutcome,
  type MobileNativeChatSendOutcome
} from './mobile-native-chat-send'
import { releaseMobileNativeChatTerminalWriteForSend } from './mobile-native-chat-terminal-write-lock'
import { clearMobileNativeChatInputResidue } from './mobile-native-chat-stale-input'
import { verifyClaudeSubmit } from './mobile-native-chat-submit-verify'
import { claudeSentBashRows } from './claude-composer-screen'
import { readMobileNativeChatScreen } from './mobile-native-chat-screen-read'
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
 * or its screen says it took the words. Codex keeps the burst it always had: the
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
      return { message: 'Message not sent' }
    }
  } else if (
    !(await clearMobileNativeChatInput({
      ...common,
      clearInput: buildMobileNativeChatClearInputForText(...believedTexts)
    }))
  ) {
    return { message: 'Message not sent' }
  }
  clearMobileNativeChatInputResidue(args.terminal)
  return null
}

export async function writeChatSend(args: {
  agent: string | null
  client: RpcClient
  terminal: string
  text: string
  /** The send carries pasted images: no clear, and no check of the input. */
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
  const seenNonces = new Set(args.receipts().map((receipt) => receipt.nonce))
  // A shell command's echo is a `! cmd` row in the scrollback, which keeps every one ever run:
  // the rows there now are the baseline a repeat has to exceed (verifyClaudeSubmit).
  const priorBashRows =
    shellCommandOfSend(text, agent) === null
      ? []
      : claudeSentBashRows((await readMobileNativeChatScreen({ client, terminal, deadline }))?.lines ?? [])
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
  if (
    outcome !== 'accepted' ||
    agent !== 'claude' ||
    !args.syncComposer ||
    args.hasImages ||
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
  const verdict = await verifyClaudeSubmit({
    client,
    terminal,
    text,
    receipts: args.receipts,
    seenNonces,
    priorBashRows,
    deadline
  })
  if (verdict.kind === 'not-sent') {
    // Claude asked the user to review it: nothing more is typed or submitted.
    return { kind: 'stopped', message: verdict.message }
  }
  // `unknown`: looks were had and none settled it. Held for the transcript or a
  // beacon copy like an ack that never came. `unverified`: no look could be had,
  // so it stands as accepted, as it did before there were looks.
  return { kind: 'written', outcome: verdict.kind === 'unknown' ? 'unknown' : 'accepted' }
}
