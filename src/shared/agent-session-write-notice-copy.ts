// The sentences a chat notice is made of, each whole so desktop can translate it on its own.

import type { AgentSessionFailureFact } from './agent-session-failure'
import {
  AGENT_STARTING,
  AGENT_STILL_WORKING,
  BACKGROUND_TASKS_RUNNING,
  QUIT_TERMINAL_AGENT,
  START_NEW_CHAT,
  TERMINAL_AGENT_HOLDS_CHAT,
  WAIT_FOR_BACKGROUND_TASKS,
  WAIT_FOR_START
} from './agent-session-failure-copy'
import type {
  AgentSessionFailureSurface,
  AgentSessionFailureWordsContext
} from './agent-session-failure-words'

/** Every sentence a notice is made of. Desktop translates each whole sentence with this as its
 *  fallback; mobile shows it as is. */
export const AGENT_SESSION_WRITE_NOTICE_COPY = {
  notDoneReadHistory: "This chat's history couldn't be loaded.",
  notDoneSend: 'Your message was not sent.',
  tryAgainComposerSend: 'Send it again.',
  notDoneStop: "The agent wasn't stopped.",
  notDoneStopTask: "The background task wasn't stopped.",
  notDoneStopTasks: "The background tasks weren't stopped.",
  notDoneAnswer: 'Your answer was not sent.',
  notDoneOption: "The setting wasn't changed.",
  notDoneCommand: "The command didn't run.",
  notDoneGoal: "The goal wasn't changed.",
  restartFailed: "The agent couldn't restart.",
  capacity: 'Orca has received too many requests in the last day.',
  outcomeUnknown: "Orca couldn't confirm what happened. Check the chat.",
  questionChanged: 'This question was already answered or has changed.',
  historyUnreadable: "Orca couldn't read this chat's saved history.",
  historyUnusable: 'Unable to load this chat.',
  historyUnavailable: "Orca couldn't open this chat's history right now.",
  savedByNewerOrca: 'Chats were saved by a newer Orca.',
  updateOrcaToKeepUsing: 'Update Orca to keep using them.',
  unsupported: "The Orca running this chat doesn't support this. Update Orca, then try again.",
  unreachable: "Orca couldn't reach the agent.",
  recordFailed: "Orca couldn't record it in this chat's history.",
  conversationCleared: 'This conversation has been cleared.',
  openCurrentConversation: 'Open the current conversation to continue.',
  clearUnfinished: "The last /clear didn't finish.",
  commandRunning: 'A /compact or /clear is still running.',
  waitForCommand: 'Wait for the /compact or /clear to finish.',
  agentStarting: AGENT_STARTING,
  waitForStart: WAIT_FOR_START,
  turnActive: 'The agent is still responding.',
  waitForTurn: 'Wait for the agent to finish responding, or stop it.',
  promptPending: 'The agent is waiting for an answer to a question or approval.',
  answerFirst: 'Answer the question or approval first.',
  backgroundTasksRunning: BACKGROUND_TASKS_RUNNING,
  waitForBackgroundTasks: WAIT_FOR_BACKGROUND_TASKS,
  messagesUnsettled: "A message you sent earlier hasn't been confirmed yet.",
  settleEarlierMessage: 'Wait for your earlier message to go through, or retry it.',
  agentStillWorking: AGENT_STILL_WORKING,
  runClearWhenDone: "Run /clear when it's done.",
  clearAfterAnswer: "Answer the agent's question or approval, then run /clear.",
  runCompactWhenDone: "Run /compact when it's done.",
  compactAfterAnswer: "Answer the agent's question or approval, then run /compact.",
  clearAfterRetry: 'Retry your earlier message, then run /clear.',
  compactAfterRetry: 'Retry your earlier message, then run /compact.',
  clearAfterSending: 'Your earlier message is still being sent. Run /clear once it has gone.',
  compactAfterSending: 'Your earlier message is still being sent. Run /compact once it has gone.',
  optionRejected: "The agent didn't accept this setting.",
  goalsUnsupported: "This agent doesn't support goals.",
  agentRefused: 'The agent turned this down.',
  ownerUnproven: "Orca hasn't confirmed that this chat's previous agent stopped.",
  reopenChat: 'Reopen the chat to check again.',
  terminalAgentHoldsChat: TERMINAL_AGENT_HOLDS_CHAT,
  quitTerminalAgent: QUIT_TERMINAL_AGENT,
  hostReconciling: 'Orca is still checking on this chat after restarting.',
  waitMoment: 'Wait a moment.',
  recordUnreadable: "Orca couldn't read this chat's saved state.",
  chatNotFound: 'The Orca running this chat has no record of it.',
  startNewChat: START_NEW_CHAT,
  tryAgain: 'Try again.'
} as const

export type AgentSessionWriteNoticeSentence = keyof typeof AGENT_SESSION_WRITE_NOTICE_COPY
/** A failure fact, worded where it is shown so desktop can say it in the reader's language. */
export type AgentSessionWriteNoticeFailurePart = {
  failure: AgentSessionFailureFact
  surface: AgentSessionFailureSurface
  context: AgentSessionFailureWordsContext
}
/** A notice as whole sentences, each translated on its own; `text` is words someone else wrote: a
 *  provider's, or a host's sentence with no fact beside it. */
export type AgentSessionWriteNoticePart =
  | AgentSessionWriteNoticeSentence
  | { text: string }
  | AgentSessionWriteNoticeFailurePart

/** Causes that already say the history can't be read here, so no sentence after them says it
 *  again. */
export const AGENT_SESSION_HISTORY_UNREAD_CAUSES: ReadonlySet<AgentSessionWriteNoticeSentence> =
  new Set(['historyUnusable', 'historyUnavailable', 'historyUnreadable', 'savedByNewerOrca'])

/** Whether these words already say this chat's history didn't load, so a pane headed by them need
 *  only add that it keeps trying. "Chats were saved by a newer Orca" names no one chat for "it". */
export function agentSessionNoticeSaysThisChatUnread(
  parts: readonly AgentSessionWriteNoticePart[]
): boolean {
  return parts.some(
    (part) =>
      typeof part === 'string' &&
      part !== 'savedByNewerOrca' &&
      (part === 'notDoneReadHistory' || AGENT_SESSION_HISTORY_UNREAD_CAUSES.has(part))
  )
}
