import {
  buildAskAnswerKeys,
  hasAskAnswer,
  type AskAnswerKeyGroup,
  type AskAnswerSelection,
  type AskPrompt
} from '../../../src/shared/native-chat-ask'

/** What the Claude app sends for a page left unanswered (t52.java:83,97,
 *  com.anthropic.claude 1.261013.20). */
export const ASK_NO_PREFERENCE = '[No preference]'

function answered(selection: AskAnswerSelection | undefined): boolean {
  return (selection?.indices.length ?? 0) > 0 || (selection?.other ?? '').trim().length > 0
}

/**
 * Claude Code's keys for an answer, a skipped page answered "[No preference]".
 *
 * The card sends a skipped page as `{ indices: [] }`. The vendored builder steps
 * past such a page with Right, which leaves a question unanswered on Claude
 * Code's review step, and no screen of that step has been captured: what it
 * highlights there, and whether one Enter submits, is unknown. Rather than guess,
 * the skipped page is answered with the Claude app's own words for one, typed
 * through the "Type something" row like any typed answer, so every page has an
 * answer and the review step is the one the 2.1.282 screens pin ("Submit answers"
 * highlighted, one Enter; claude-ask-answer-keys-screens.test.ts).
 *
 * Only a form of two or more questions with something answered: a lone question
 * has no page to skip (Skip declines it), and a form with nothing answered gets
 * no keys at all: the vendored builder would step it to the review step and
 * press Enter there, on the same unknown screen. The senders refuse it first.
 */
export function buildClaudeAskAnswerKeys(
  prompt: AskPrompt,
  selections: AskAnswerSelection[]
): AskAnswerKeyGroup[] {
  if (!hasAskAnswer(prompt, selections)) {
    return []
  }
  if (prompt.questions.length < 2) {
    return buildAskAnswerKeys(prompt, selections)
  }
  const marked = prompt.questions.map((_, i) => {
    const selection = selections[i] ?? { indices: [] }
    return answered(selection) ? selection : { indices: [], other: ASK_NO_PREFERENCE }
  })
  return buildAskAnswerKeys(prompt, marked)
}
