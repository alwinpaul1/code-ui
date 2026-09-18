import {
  buildAskAnswerKeys,
  buildCodexAskAnswerKeys,
  hasAskAnswer,
  nativeChatAskDismissKey,
  type AskAnswerKeyGroup,
  type AskAnswerSelection,
  type AskPrompt
} from '../../../src/shared/native-chat-ask'
import {
  resolveNativeChatTranscriptAgent,
  shouldStepNativeChatAskAnswer
} from '../../../src/shared/native-chat-agent-support'
import { stepAskAnswerKeyGroups } from '../session/mobile-native-chat-answer-stepping'
import {
  openMobileNativeChatSendBudget,
  sendMobileNativeChatMessageWithOutcome,
  type MobileNativeChatSendOutcome
} from '../session/mobile-native-chat-send'
import {
  acquireMobileNativeChatTerminalWrite,
  clearMobileNativeChatTerminalHalfStep,
  markMobileNativeChatTerminalHalfStepped,
  mobileNativeChatTerminalHalfStep,
  releaseMobileNativeChatTerminalWrite
} from '../session/mobile-native-chat-terminal-write-lock'
import type { RpcClient } from '../transport/rpc-client'

/** Why a log at all: this runs from a notification tap, often with no screen
 *  up. A tap that did nothing is indistinguishable from a slow one unless the
 *  one line left behind says which host, which terminal, and which step. */
function refused(detail: {
  hostId: string
  terminal: string
  step: string
  /** The write's outcome, or why no write was tried; free text for a
   *  half-stepped refusal, which quotes the earlier step. */
  outcome?: string
}): false {
  console.warn('[question-notification] answer not written', detail)
  return false
}

/**
 * The keystrokes for the answer, built by the agent's own builder — the same
 * two the chat card uses, fed the same selections the card would build (a
 * pick is `{ indices: [i] }`, a typed Other answer `{ indices: [], other }`).
 * Null for an agent whose selector cannot be driven by number: Grok and OMP
 * commit a pasted LABEL plus Enter, after a clear of whatever sits in the
 * composer, which is only safe with the card's stale-input heal in front of
 * it. The shade has no such thing.
 */
function keysFor(
  agent: string,
  prompt: AskPrompt,
  selections: AskAnswerSelection[]
): AskAnswerKeyGroup[] | null {
  if (!shouldStepNativeChatAskAnswer(agent)) {
    return null
  }
  return resolveNativeChatTranscriptAgent(agent) === 'codex'
    ? buildCodexAskAnswerKeys(prompt, selections)
    : buildAskAnswerKeys(prompt, selections)
}

/**
 * Write an answer to the agent's selector, from the shade.
 *
 * Same contract as the chat card's answer: option numbers with `enter:
 * false`, typed text as raw keystrokes with its line breaks collapsed,
 * through `terminal.send`, paced by the shared stepper under the terminal
 * write lock. A single pick is one keystroke; a typed Other answer or a
 * multi-select is several, a step apart.
 *
 * Only 'accepted' counts as sent. For a one-keystroke answer, 'unknown' means
 * the ack was lost and the digit may still have landed — a retry is safe,
 * because the caller re-checks the prompt before every send and finds none
 * once one has. A multi-step answer that stops part-way is a different
 * matter: the selector has moved, the prompt has not, and a retry from
 * scratch would type the row number into the open text field or toggle a box
 * back off. So the terminal is marked half-stepped for THIS prompt, the mark
 * is shared with the chat card, and every later tap for the same prompt is
 * refused until the agent asks something else (or, on the lookup's side,
 * leaves waiting). The user has to finish it in the session.
 *
 * Never throws. Never writes without the lock.
 */
export async function sendQuestionAnswerFromNotification(args: {
  hostId: string
  client: RpcClient
  terminal: string
  agent: string
  prompt: AskPrompt
  selections: AskAnswerSelection[]
}): Promise<boolean> {
  const { hostId, client, terminal } = args
  if (!hasAskAnswer(args.prompt, args.selections)) {
    return refused({ hostId, terminal, step: 'build-keys', outcome: 'no-answer' })
  }
  const groups = keysFor(args.agent, args.prompt, args.selections)
  if (groups === null) {
    return refused({ hostId, terminal, step: 'build-keys', outcome: 'unsupported-agent' })
  }
  const promptKey = nativeChatAskDismissKey(args.prompt) ?? ''
  const halfStep = mobileNativeChatTerminalHalfStep(terminal)
  if (halfStep) {
    if (halfStep.promptKey === promptKey) {
      return refused({ hostId, terminal, step: 'half-stepped', outcome: halfStep.detail })
    }
    // A different prompt: the selector has been redrawn since.
    clearMobileNativeChatTerminalHalfStep(terminal)
  }
  // A digit landing mid-flight in the card's own paced answer or an image
  // paste would interleave bytes into the PTY.
  if (!acquireMobileNativeChatTerminalWrite(terminal)) {
    return refused({ hostId, terminal, step: 'lock', outcome: 'busy' })
  }
  // A holder, not a `let`: the write closure assigns it, and TypeScript would
  // otherwise narrow the initial value for the comparison below.
  const last: { outcome: MobileNativeChatSendOutcome } = { outcome: 'rejected' }
  try {
    const stepped = await stepAskAnswerKeyGroups({
      groups,
      deadline: openMobileNativeChatSendBudget(),
      write: async (body, deadline) => {
        last.outcome = await sendMobileNativeChatMessageWithOutcome({
          client,
          terminal,
          text: body,
          enter: false,
          deadline
        })
        return last.outcome === 'accepted'
      },
      wait: (ms) => new Promise((resolve) => setTimeout(() => resolve(true), ms))
    })
    switch (stepped.kind) {
      case 'sent':
        return true
      case 'failed': {
        const step = `write ${stepped.step + 1}/${groups.length}`
        // Half written: an earlier group landed, or this one may have (a lost
        // ack). A one-group plan that was refused outright left nothing behind.
        if (groups.length > 1 && (stepped.step > 0 || last.outcome === 'unknown')) {
          markMobileNativeChatTerminalHalfStepped(terminal, {
            promptKey,
            detail: `${step} ${last.outcome}`
          })
        }
        return refused({ hostId, terminal, step, outcome: last.outcome })
      }
      case 'cancelled':
      case 'nothing-to-send':
        return refused({ hostId, terminal, step: stepped.kind })
      default: {
        const exhaustive: never = stepped
        return exhaustive
      }
    }
  } catch {
    return refused({ hostId, terminal, step: 'write' })
  } finally {
    releaseMobileNativeChatTerminalWrite(terminal)
  }
}
