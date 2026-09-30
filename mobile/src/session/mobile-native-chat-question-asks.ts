// What the lines around a reply's choice list ask, for the question card
// (mobile-native-chat-question.ts).

import { lineAsks, type OptionList } from './mobile-native-chat-question-lists'

/** Words that ask the reader to choose. */
const CHOOSES = /\b(?:which|pick|choose|select|prefer\w*)\b/i

/**
 * A line that asks leave to go on rather than for a choice: Shall I…, Should
 * I…, Can I…, Want me to…, OK to…, Proceed?, Sound good?, Does this look
 * right? Read from the line's first word (after an `OK,` or `So` in front of
 * it), so "Which should I do?" is no confirmation.
 */
const CONFIRMS = new RegExp(
  [
    String.raw`^[^\p{L}\p{N}]*(?:(?:ok(?:ay)?|so|alright|and|or|then)\b[\s,]*)?`,
    '(?:',
    [
      /(?:shall|should|can|could|may|will|would)\s+(?:i|we)\b/.source,
      /(?:do\s+you\s+)?want\s+me\b/.source,
      /would\s+you\s+like\s+me\b/.source,
      /ok(?:ay)?\s+(?:to|if)\b/.source,
      /is\s+(?:it|this|that)\s+(?:ok|okay|fine|alright)\b/.source,
      /(?:proceed|continue|go\s+ahead|ready|good\s+to\s+go|all\s+good)\b/.source,
      /(?:sounds?|looks?)\s+(?:good|right|ok|okay|fine)\b/.source,
      /(?:does|do)\s+(?:this|that|it|these)\s+look\b/.source
    ].join('|'),
    ')'
  ].join(''),
  'iu'
)

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whether `line` names `word` as a whole word, in any case. */
function names(line: string, word: string): boolean {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'iu').test(line)
}

/** Whether `line` offers two of the list's choices, `1 or 2`, `A or B`,
 *  `Rebase or merge`, by marker or by label. */
function namesTwoChoices(line: string, list: OptionList): boolean {
  if (!/\bor\b/i.test(line)) {
    return false
  }
  const named = list.items.filter(({ token, label }) => {
    const plain = label.replace(/[*_`]/g, '').trim()
    return (token != null && names(line, token)) || (plain.length > 0 && names(line, plain))
  })
  return named.length >= 2
}

/**
 * Whether a line that asks, after the choices, asks the reader to choose
 * from them. A tap on the card sends a choice's marker or words as the
 * answer, so under "Shall I proceed?" it sent `1` to a yes/no question, or a
 * listed change as the reply (review, 2026-09-30). Only a line that names two
 * of the choices or asks which, pick, choose, select or prefer, and does not
 * ask leave to go on, keeps the card; anything else, "What do you think?"
 * too, is a guess.
 */
export function asksToChoose(line: string, list: OptionList): boolean {
  return namesTwoChoices(line, list) || (CHOOSES.test(line) && !CONFIRMS.test(line))
}

/**
 * The lines that ask after the list at `at`: prose from its end to the end of
 * the reply, outside every later list and every code fence. The later lists'
 * lines are marked once: checking each line against every list cost 376 ms
 * for a reply of 5,000 notes lists, on the render path (2026-09-30).
 */
export function asksAfter(
  lines: readonly string[],
  lists: readonly OptionList[],
  at: number,
  fenceStarts: readonly number[]
): string[] {
  const inLaterList = new Uint8Array(lines.length)
  for (const list of lists.slice(at + 1)) {
    inLaterList.fill(1, list.start, list.end + 1)
  }
  const asks: string[] = []
  for (let index = lists[at].end + 1; index < lines.length; index += 1) {
    if (fenceStarts[index] === -1 && inLaterList[index] === 0 && lineAsks(lines[index])) {
      asks.push(lines[index])
    }
  }
  return asks
}
