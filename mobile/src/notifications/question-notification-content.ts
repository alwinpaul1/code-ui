import type { AskPrompt, AskQuestion } from '../../../src/shared/native-chat-ask'
import { shouldStepNativeChatAskAnswer } from '../../../src/shared/native-chat-agent-support'
import { notificationPlainText } from './notification-plain-text'
import { agentHeadlineLabel } from './notification-presentation'

/** A button that picks one option of a single-choice question. */
export type QuestionPickAction = {
  /** What Android hands back when the action is tapped. */
  identifier: string
  label: string
  /** Index into the question's options. */
  pick: number
}

/** The one button offered when the shade cannot hold the answer: it opens the
 *  app on the session, where the full card is. */
export type QuestionOpenAction = {
  identifier: typeof QUESTION_ANSWER_ACTION
  label: 'Answer'
  opensApp: true
}

export type QuestionNotificationAction = QuestionPickAction | QuestionOpenAction

export type QuestionNotificationContent = {
  title: string
  body: string
  actions: QuestionNotificationAction[]
}

export const QUESTION_ANSWER_ACTION = 'question:answer'

/**
 * Android draws at most three actions on a notification and silently drops the
 * rest. A question with more choices than that is not answered from the shade
 * with the three that fit: buttons that answer PART of a question are worse
 * than none, so it gets the Answer route instead.
 */
const MAX_PICK_ACTIONS = 3

/** Android clips a longer action title without saying so; the cut is made here,
 *  where it can carry an ellipsis. Real labels run to 40 characters. */
const ACTION_LABEL_LIMIT = 20

/** Identity is the INDEX, never the label: Android returns only this string,
 *  and two options may read alike once shortened. */
function pickIdentifier(index: number): string {
  return `question:${index}`
}

function shortenLabel(label: string): string {
  const flat = label.replace(/\s+/g, ' ').trim()
  return flat.length > ACTION_LABEL_LIMIT ? `${flat.slice(0, ACTION_LABEL_LIMIT - 1)}…` : flat
}

/**
 * Whether the shade can answer this prompt with one button per choice: one
 * question, single-select, no more choices than Android draws, and an agent
 * whose selector takes a digit. Everything else — several questions, a
 * multi-select, four or more options, a question with no options at all (free
 * text only), or Grok/OMP, which commit a pasted label plus Enter that is only
 * safe behind the card's stale-input heal — needs the card in the app.
 */
function picksFitTheShade(prompt: AskPrompt, agent: string | null): AskQuestion | null {
  if (!shouldStepNativeChatAskAnswer(agent) || prompt.questions.length !== 1) {
    return null
  }
  const question = prompt.questions[0]!
  if (question.multiSelect || question.options.length === 0) {
    return null
  }
  return question.options.length <= MAX_PICK_ACTIONS ? question : null
}

function questionTitle(
  question: AskQuestion,
  context: { agent: string | null; location: string | null }
): string {
  const header = (question.header ?? '').trim()
  if (header !== '') {
    return context.location ? `${header} · ${context.location}` : header
  }
  const who = agentHeadlineLabel(context.agent) ?? 'Agent'
  const headline = `${who} has a question`
  return context.location ? `${headline} · ${context.location}` : headline
}

/**
 * The question, then its choices as "1 Label · 2 Label": numbered the way the
 * agent's own selector numbers them, joined by the middot the table flattener
 * already uses, and never a pipe, which the plain-text pass would read as a
 * table cell. The whole body then takes the same styling as every other
 * banner, so Markdown in a question reads the way it does everywhere else.
 */
function questionBody(prompt: AskPrompt): string {
  const first = prompt.questions[0]!
  const lines = [first.question.trim()]
  if (first.options.length > 0) {
    lines.push(
      first.options
        .map((option, index) => `${index + 1} ${option.label.replace(/\s+/g, ' ').trim()}`)
        .join(' \u00b7 ')
    )
  }
  if (first.multiSelect) {
    lines.push('Pick any that apply')
  }
  const more = prompt.questions.length - 1
  if (more > 0) {
    lines.push(`+${more} more question${more === 1 ? '' : 's'}`)
  }
  return notificationPlainText(lines.filter((line) => line !== '').join('\n'))
}

/**
 * What the shade should show for a question the agent is waiting on.
 *
 * Built from the QUESTION, never from the desktop's notification body: that
 * said "Using AskUserQuestion", the tool's name, when the question itself was
 * on the host verbatim.
 *
 * Claude's TUI draws an "Other" free-text row under every question. It is not
 * in the tool input and is not offered here: the shade has no text field, and
 * the Answer route (which opens the card) covers it.
 *
 * Always yields content: unlike a permission with nothing to send, a question
 * can always at least open the app to be answered.
 */
export function questionNotificationContent(
  prompt: AskPrompt,
  context: { agent: string | null; location: string | null }
): QuestionNotificationContent {
  const question = picksFitTheShade(prompt, context.agent)
  const actions: QuestionNotificationAction[] = question
    ? question.options.map((option, index) => ({
        identifier: pickIdentifier(index),
        label: shortenLabel(option.label),
        pick: index
      }))
    : [{ identifier: QUESTION_ANSWER_ACTION, label: 'Answer', opensApp: true }]
  return {
    title: questionTitle(prompt.questions[0]!, context),
    body: questionBody(prompt),
    actions
  }
}
