import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildAskAnswerKeys,
  hasAskAnswer,
  type AskAnswerKeyGroup,
  type AskPrompt
} from '../../../src/shared/native-chat-ask'

type Screen = { sent: string; lines: string[] }

/** The screens of one captured flow, each after the key its marker names. */
function readScreens(name: string): Screen[] {
  const text = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
  const screens: Screen[] = []
  for (const line of text.split('\n')) {
    const marker = /^=== screen: (.*) ===$/.exec(line)
    if (marker) {
      screens.push({ sent: marker[1]!, lines: [] })
    } else {
      // Lines before the first marker are the fixture's header.
      screens.at(-1)?.lines.push(line)
    }
  }
  return screens
}

/** The number Claude draws beside an option: `❯ 1. Yes, push…`, `  3. [ ] Typecheck`. */
function drawnNumber(screen: Screen, label: string): string | undefined {
  for (const line of screen.lines) {
    const row = /^(?:❯| ) (\d+)\. (?:\[[ ✔]\] )?(.*)$/.exec(line)
    if (row?.[2] === label) {
      return row[1]
    }
  }
  return undefined
}

/** Claude's review step, with "Submit answers" highlighted as Enter's pick. */
function showsReviewStep(screen: Screen): boolean {
  return (
    screen.lines.includes('Review your answers') &&
    screen.lines.includes('Ready to submit your answers?') &&
    screen.lines.includes('❯ 1. Submit answers') &&
    screen.lines.includes('  2. Cancel')
  )
}

// Claude parts some row glyphs from their text with a no-break space: `⏺`
// before "User answered", and the prompt's `❯`. The `⎿` under it is followed by
// a space and then one. Option rows use a plain space.
const NBSP = '\u00a0'

/** The rows Claude prints under "User answered Claude's questions:". */
function answeredRows(screen: Screen): string[] {
  const start = screen.lines.indexOf(`⏺${NBSP}User answered Claude's questions:`)
  if (start === -1) {
    return []
  }
  const rows: string[] = []
  for (const line of screen.lines.slice(start + 1)) {
    if (line.trim() === '') {
      break
    }
    rows.push(line.replace(/^\s*(?:⎿\s+)?/, ''))
  }
  return rows
}

function keys(groups: AskAnswerKeyGroup[]): string[] {
  return groups.map((group) => ('raw' in group ? group.raw : group.text))
}

const PUSH: AskPrompt = {
  questions: [
    {
      question: 'Push the branch?',
      header: 'Push',
      multiSelect: false,
      options: [
        { label: 'Yes, push to PR 1100', description: 'Push now' },
        { label: 'No, keep it local', description: 'Stay local' }
      ]
    }
  ]
}

const CHECKS: AskPrompt = {
  questions: [
    {
      question: 'Which checks should run?',
      header: 'Checks',
      multiSelect: true,
      options: [{ label: 'Unit tests' }, { label: 'Lint' }, { label: 'Typecheck' }]
    }
  ]
}

const TWO_QUESTIONS: AskPrompt = {
  questions: [
    {
      question: 'Where should the Hours view go?',
      header: 'Placement',
      multiSelect: false,
      options: [{ label: 'Tab in Fleet' }, { label: 'New sidebar page' }]
    },
    {
      question: 'Push after the change?',
      header: 'Push',
      multiSelect: false,
      options: [{ label: 'Yes, push to PR 1100' }, { label: 'No, keep it local' }]
    }
  ]
}

// 2026-09-25, from the phone: on a one-question single-select card the user
// had to tap Submit twice. The suspicion was that Claude Code had started to
// show its "Review your answers" step after the option number, so the phone's
// lone number only opened it and the second tap's number confirmed it. Driven
// live on Claude Code 2.1.281 and 2.1.282, it does not: Claude submits on the
// number, and the review step exists only for the two shapes that already end
// with one Enter. (2.1.282's own code agrees: a lone single-select question
// hides its Submit tab and answers straight from the option's change handler.)
// So the key plans are right as they are, and these screens pin them.
// 2.1.283 draws the model's own questions with 2.1.282's code (binaries
// compared 2026-09-26, not driven live). Its one change is for a confirmation
// Claude Code forces itself (`isEngineConfirm`): the question text is split at
// its first blank line and the rest drawn under the title, above the options,
// which moves no option number.
describe('answering Claude AskUserQuestion, on the screens Claude Code 2.1.281 and 2.1.282 draw', () => {
  it.each([
    ['2.1.282', 'claude-screen-ask-single-select-2.1.282.txt', 1],
    ['2.1.281', 'claude-screen-ask-single-select-2.1.281.txt', 0]
  ])(
    'answers a lone single-select question with one tap on %s: its number, no review step',
    (_version, file, index) => {
      const [ask, after] = readScreens(file)
      const label = PUSH.questions[0]!.options[index]!.label
      const plan = keys(buildAskAnswerKeys(PUSH, [{ indices: [index] }]))

      expect(plan).toEqual([drawnNumber(ask!, label)])
      expect(after!.sent).toBe(`after ${plan[0]}`)
      expect(answeredRows(after!)).toEqual([`· Push the branch? → ${label}`])
      expect(showsReviewStep(after!)).toBe(false)
    }
  )

  it('sends no confirm after that number, which Claude would type into its prompt (2.1.281)', () => {
    const [, answered, secondNumber] = readScreens('claude-screen-ask-single-select-2.1.281.txt')

    // The answer was already in; the question is gone, and the next "1" landed
    // on Claude's prompt row (`❯` then a no-break space, as Claude draws it).
    expect(answeredRows(answered!)).toEqual(['· Push the branch? → Yes, push to PR 1100'])
    expect(secondNumber!.lines).toContain(`❯${NBSP}1`)
    expect(secondNumber!.lines.some((line) => line.startsWith('Enter to select'))).toBe(false)
    expect(buildAskAnswerKeys(PUSH, [{ indices: [0] }])).toHaveLength(1)
  })

  it('confirms a lone multi-select on its review step with exactly one Enter (2.1.282)', () => {
    const [ask, afterFirst, afterSecond, onSubmitTab, afterEnter] = readScreens(
      'claude-screen-ask-multi-select-2.1.282.txt'
    )
    const plan = keys(buildAskAnswerKeys(CHECKS, [{ indices: [0, 2] }]))

    // Each screen was captured after the plan's key of the same position.
    expect(
      [afterFirst, afterSecond, onSubmitTab, afterEnter].map((screen) => screen!.sent)
    ).toEqual(['after 1', 'after 3', 'after Right', 'after Enter'])
    expect(plan).toEqual([
      drawnNumber(ask!, 'Unit tests'),
      drawnNumber(ask!, 'Typecheck'),
      '\x1b[C',
      '\r'
    ])
    expect(afterFirst!.lines).toContain('❯ 1. [✔] Unit tests')
    expect(afterSecond!.lines).toContain('  3. [✔] Typecheck')
    // A toggle submits nothing; Right is what opens the review step.
    expect(showsReviewStep(afterSecond!)).toBe(false)
    expect(showsReviewStep(onSubmitTab!)).toBe(true)
    expect(onSubmitTab!.lines).toContain('   → Unit tests, Typecheck')
    expect(answeredRows(afterEnter!)).toEqual([
      '· Which checks should run? → Unit tests, Typecheck'
    ])
    expect(plan.filter((key) => key === '\r')).toEqual(['\r'])
  })

  it('confirms a two-question form on the review step its last number opens, with one Enter (2.1.282)', () => {
    const [ask, onSecond, onReview, afterEnter] = readScreens(
      'claude-screen-ask-two-questions-2.1.282.txt'
    )
    const plan = keys(buildAskAnswerKeys(TWO_QUESTIONS, [{ indices: [0] }, { indices: [0] }]))

    expect([onSecond, onReview, afterEnter].map((screen) => screen!.sent)).toEqual([
      'after 1',
      'after 1',
      'after Enter'
    ])
    expect(plan).toEqual([
      drawnNumber(ask!, 'Tab in Fleet'),
      drawnNumber(onSecond!, 'Yes, push to PR 1100'),
      '\r'
    ])
    expect(onSecond!.lines).toContain('Push after the change?')
    expect(showsReviewStep(onSecond!)).toBe(false)
    expect(showsReviewStep(onReview!)).toBe(true)
    expect(answeredRows(afterEnter!)).toEqual([
      '· Where should the Hours view go? → Tab in Fleet',
      '· Push after the change? → Yes, push to PR 1100'
    ])
  })

  it('writes nothing for an unanswered question, and refuses a form with nothing answered', () => {
    expect(buildAskAnswerKeys(PUSH, [{ indices: [] }])).toEqual([])
    expect(hasAskAnswer(PUSH, [{ indices: [] }])).toBe(false)
    expect(hasAskAnswer(TWO_QUESTIONS, [{ indices: [] }, { indices: [] }])).toBe(false)
  })
})
