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

/** A reply field on the notification (Android RemoteInput). The user types
 *  the answer in the shade and never opens the app. */
export type QuestionReplyAction = {
  identifier: typeof QUESTION_OTHER_ACTION | typeof QUESTION_ANSWER_ACTION
  label: 'Other…' | 'Answer'
  textInput: { placeholder: string }
}

export type QuestionNotificationAction = QuestionPickAction | QuestionReplyAction

export type QuestionNotificationContent = {
  title: string
  body: string
  actions: QuestionNotificationAction[]
}

/** The "Other…" field beside option buttons: whatever is typed is the
 *  free-text answer, digits included. */
export const QUESTION_OTHER_ACTION = 'question:other'
/** The one field that answers a prompt the buttons cannot: option numbers or
 *  words, one answer per question. */
export const QUESTION_ANSWER_ACTION = 'question:answer'

export const OTHER_PLACEHOLDER = 'Type your answer'
export const ANSWER_PLACEHOLDER_NUMBERS = 'Number(s), e.g. 2 or 1,3, or type your answer'
export const ANSWER_PLACEHOLDER_PER_QUESTION = 'One answer per question, separated by ;'
const PER_QUESTION_FORMAT = 'Reply with one answer per question, separated by ;'

/**
 * Android draws at most three actions on a notification and silently drops the
 * rest. Three single-choice options are three buttons and nothing else; with
 * fewer, the Other field takes the spare slot. More choices than that, a
 * multi-select, or several questions are answered through one reply field.
 */
const MAX_ACTIONS = 3

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

function otherField(): QuestionReplyAction {
  return { identifier: QUESTION_OTHER_ACTION, label: 'Other…', textInput: { placeholder: OTHER_PLACEHOLDER } }
}

function answerField(placeholder: string): QuestionReplyAction {
  return { identifier: QUESTION_ANSWER_ACTION, label: 'Answer', textInput: { placeholder } }
}

/**
 * What the shade offers to answer with. Nothing for Grok/OMP: they commit a
 * pasted label plus Enter after a composer clear, which is only safe behind
 * the card's stale-input heal, and a digit would be wrong for them. Their
 * banner is captioned and that is all.
 */
function questionActions(prompt: AskPrompt, agent: string | null): QuestionNotificationAction[] {
  if (!shouldStepNativeChatAskAnswer(agent)) {
    return []
  }
  if (prompt.questions.length > 1) {
    return [answerField(ANSWER_PLACEHOLDER_PER_QUESTION)]
  }
  const question = prompt.questions[0]!
  if (question.options.length === 0) {
    // Free text is the only answer there is.
    return [otherField()]
  }
  // A blank label (the parser lets `label: ''` through) would be a button with
  // nothing on it; the numbered body still says what each option is.
  const unlabelled = question.options.some((option) => option.label.trim() === '')
  if (question.multiSelect || question.options.length > MAX_ACTIONS || unlabelled) {
    return [answerField(ANSWER_PLACEHOLDER_NUMBERS)]
  }
  const picks: QuestionNotificationAction[] = question.options.map((option, index) => ({
    identifier: pickIdentifier(index),
    label: shortenLabel(option.label),
    pick: index
  }))
  // The card draws an "Other…" row under every question; the shade draws its
  // field only while a slot is free. Three choices fill the shade, and a
  // one-tap choice is the likelier need than typing.
  return picks.length < MAX_ACTIONS ? [...picks, otherField()] : picks
}

function questionTitle(
  question: AskQuestion,
  context: { agent: string | null; location: string | null }
): string {
  const header = (question.header ?? '').trim()
  if (header !== '') {
    return context.location ? `${context.location} · ${header}` : header
  }
  const who = agentHeadlineLabel(context.agent) ?? 'Agent'
  const headline = `${who} has a question`
  return context.location ? `${context.location} · ${headline}` : headline
}

/** "1 Label · 2 Label": numbered the way the agent's own selector numbers
 *  them, joined by the middot the table flattener already uses, and never a
 *  pipe, which the plain-text pass would read as a table cell. */
function optionsLine(question: AskQuestion): string | null {
  if (question.options.length === 0) {
    return null
  }
  return question.options
    .map((option, index) => `${index + 1} ${option.label.replace(/\s+/g, ' ').trim()}`)
    .join(' · ')
}

/**
 * The question and its choices. Several questions are all said, each with its
 * number, because one reply answers all of them and the reader has to see
 * what they are answering. The whole body then takes the same styling as
 * every other banner, so Markdown in a question reads the way it does
 * everywhere else.
 */
function questionBody(prompt: AskPrompt): string {
  const several = prompt.questions.length > 1
  const lines: (string | null)[] = []
  prompt.questions.forEach((question, index) => {
    const text = question.question.trim()
    lines.push(several ? `Q${index + 1} ${text}`.trim() : text)
    lines.push(optionsLine(question))
    if (question.multiSelect && !several) {
      lines.push('Pick any that apply')
    }
  })
  if (several) {
    lines.push(PER_QUESTION_FORMAT)
  }
  return notificationPlainText(
    lines.filter((line): line is string => line !== null && line !== '').join('\n')
  )
}

/**
 * What the shade should show for a question the agent is waiting on.
 *
 * Built from the QUESTION, never from the desktop's notification body: that
 * said "Using AskUserQuestion", the tool's name, when the question itself was
 * on the host verbatim.
 *
 * The user answers here and never opens the app: a button per choice where
 * they fit, and a reply field for everything else — the free-text "Other"
 * row the agent's selector draws under every question, a question with more
 * choices than the shade has buttons, a multi-select, or several questions
 * answered in one line.
 */
export function questionNotificationContent(
  prompt: AskPrompt,
  context: { agent: string | null; location: string | null }
): QuestionNotificationContent {
  return {
    title: questionTitle(prompt.questions[0]!, context),
    body: questionBody(prompt),
    actions: questionActions(prompt, context.agent)
  }
}
