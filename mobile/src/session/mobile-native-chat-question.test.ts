import { describe, expect, it } from 'vitest'
import {
  formatQuestionAnswer,
  formatQuestionAnswerByIndexes,
  formatQuestionFreeTextAnswer,
  mobileChatQuestionKey,
  parseAgentQuestion,
  type MobileChatQuestion
} from './mobile-native-chat-question'

describe('parseAgentQuestion', () => {
  it('parses a numbered list with a question line', () => {
    const text = ['Which database should I use?', '1. PostgreSQL', '2. MySQL', '3. SQLite'].join(
      '\n'
    )
    const q = parseAgentQuestion(text)
    expect(q).not.toBeNull()
    expect(q?.question).toBe('Which database should I use?')
    expect(q?.options).toEqual(['PostgreSQL', 'MySQL', 'SQLite'])
    expect(q?.optionTokens).toEqual(['1', '2', '3'])
    expect(q?.multiSelect).toBe(false)
  })

  it('parses numbered lists using ) markers', () => {
    const q = parseAgentQuestion('Pick:\n1) Yes\n2) No')
    expect(q?.options).toEqual(['Yes', 'No'])
    expect(q?.optionTokens).toEqual(['1', '2'])
  })

  it('parses a bulleted list', () => {
    const text = ['How should we proceed?', '- Rebase', '- Merge', '* Squash'].join('\n')
    const q = parseAgentQuestion(text)
    expect(q?.options).toEqual(['Rebase', 'Merge', 'Squash'])
    expect(q?.optionTokens).toEqual([null, null, null])
    expect(q?.question).toBe('How should we proceed?')
  })

  it('parses lettered options in brackets and parens', () => {
    const q = parseAgentQuestion('Choose one:\n[a] Alpha\n[b] Beta')
    expect(q?.options).toEqual(['Alpha', 'Beta'])
    expect(q?.optionTokens).toEqual(['a', 'b'])

    const q2 = parseAgentQuestion('Choose one:\na) Alpha\nb) Beta')
    expect(q2?.options).toEqual(['Alpha', 'Beta'])
    expect(q2?.optionTokens).toEqual(['a', 'b'])
  })

  it('strips a leading pointer/highlight glyph from the selected row', () => {
    const text = ['Select a target:', '❯ 1. main', '  2. develop'].join('\n')
    const q = parseAgentQuestion(text)
    expect(q?.options).toEqual(['main', 'develop'])
    expect(q?.optionTokens).toEqual(['1', '2'])
  })

  it('drops a trailing colon but keeps a question mark in the title', () => {
    expect(parseAgentQuestion('Options:\n1. A\n2. B')?.question).toBe('Options')
    expect(parseAgentQuestion('Ready?\n1. A\n2. B')?.question).toBe('Ready?')
  })

  it('returns null for ordinary prose with no option list', () => {
    expect(parseAgentQuestion('I finished the refactor and ran the tests.')).toBeNull()
    expect(parseAgentQuestion('')).toBeNull()
    expect(parseAgentQuestion('   ')).toBeNull()
  })

  it('returns null for a single bare option with no introducing prompt', () => {
    // A lone "- item" in prose must not be treated as a question.
    expect(parseAgentQuestion('Here is what I did:\nsome work\n- one stray bullet')).toBeNull()
  })

  it('accepts a single option when introduced by a prompt line', () => {
    const q = parseAgentQuestion('Apply this change?\n1. Yes, apply it')
    expect(q).not.toBeNull()
    expect(q?.options).toEqual(['Yes, apply it'])
  })

  it('uses a fallback title when no introducing line exists', () => {
    const q = parseAgentQuestion('1. Alpha\n2. Beta')
    expect(q?.question).toBe('Choose an option')
    expect(q?.options).toEqual(['Alpha', 'Beta'])
  })

  it('detects multi-select hints', () => {
    expect(parseAgentQuestion('Select all that apply:\n1. A\n2. B')?.multiSelect).toBe(true)
    expect(parseAgentQuestion('Choose multiple:\n- A\n- B')?.multiSelect).toBe(true)
    expect(parseAgentQuestion('Pick one:\n1. A\n2. B')?.multiSelect).toBe(false)
  })

  it('does not flag multi-select when only one option is present', () => {
    const q = parseAgentQuestion('Select all that apply?\n1. Only one')
    expect(q?.multiSelect).toBe(false)
  })

  it('finds the question line nearest the options, skipping blanks', () => {
    const text = ['Some preamble.', '', 'Which branch?', '', '1. main', '2. dev'].join('\n')
    const q = parseAgentQuestion(text)
    expect(q?.question).toBe('Which branch?')
  })
})

// A waiting agent's last reply often lists findings before it asks. The card
// took every bullet and numbered line in the reply as an option, titled itself
// with the line above the FIRST bullet, and sent a finding's label back as the
// answer. The options are the one list directly under the question, and when
// that shape is not there the card is not shown: a card that answers with the
// wrong label is worse than no card.
describe('the question card for a reply with more than one list', () => {
  const findingsThenChoice = [
    'Findings so far:',
    '- the cache is stale',
    '- the lock is held',
    '',
    'Which fix do you want?',
    '1. Clear the cache',
    '2. Release the lock'
  ].join('\n')

  it('offers the choice list under the question, not the findings above it', () => {
    const q = parseAgentQuestion(findingsThenChoice)
    expect(q?.question).toBe('Which fix do you want?')
    expect(q?.options).toEqual(['Clear the cache', 'Release the lock'])
    expect(q?.optionTokens).toEqual(['1', '2'])
  })

  it('answers with the choice list marker, not a finding', () => {
    const q = parseAgentQuestion(findingsThenChoice)!
    // The card's first and last rows.
    expect(formatQuestionAnswerByIndexes(q, [0])).toBe('1')
    expect(formatQuestionAnswerByIndexes(q, [q.options.length - 1])).toBe('2')
  })

  it('takes a one-option choice list under a question after the findings', () => {
    const q = parseAgentQuestion(
      'Findings so far:\n- the cache is stale\n\nApply the fix?\n1. Yes, clear the cache'
    )
    expect(q?.question).toBe('Apply the fix?')
    expect(q?.options).toEqual(['Yes, clear the cache'])
  })

  it('shows no card when a notes list follows the choice list', () => {
    expect(
      parseAgentQuestion(
        [
          'Which fix do you want?',
          '1. Clear the cache',
          '2. Release the lock',
          '',
          'Notes:',
          '- the cache is stale',
          '- the lock is held'
        ].join('\n')
      )
    ).toBeNull()
  })

  it('shows no card when the last list has no question directly above it', () => {
    // Prose that asks nothing.
    expect(
      parseAgentQuestion('Findings:\n- a\n- b\n\nI changed two files\n1. src/a.ts\n2. src/b.ts')
    ).toBeNull()
    // Another list, a blank line up.
    expect(
      parseAgentQuestion('Findings so far:\n- the cache is stale\n- the lock is held\n\n1. Clear\n2. Release')
    ).toBeNull()
    // Another list, directly above.
    expect(parseAgentQuestion('Which fix?\n- the cache\n1. Clear\n2. Release')).toBeNull()
  })

  it('shows no card when the reply asks two questions with a list each', () => {
    // Answering `2` would not say which question it answers.
    expect(
      parseAgentQuestion('Which database?\n1. Postgres\n2. SQLite\n\nWhich ORM?\n1. Prisma\n2. Drizzle')
    ).toBeNull()
  })

  it('reads a multi-select hint from the question, not the findings', () => {
    const q = parseAgentQuestion(
      'Checked one or more caches\n- a is stale\n- b is stale\n\nWhich cache should I clear?\n1. a\n2. b'
    )
    expect(q?.options).toEqual(['a', 'b'])
    expect(q?.multiSelect).toBe(false)
  })

  it('shows no card for an empty or blank reply', () => {
    expect(parseAgentQuestion('')).toBeNull()
    expect(parseAgentQuestion('\n\n  \n')).toBeNull()
  })

  // Shapes of a Claude Code reply: markdown, blank lines around each block,
  // bold labels, and the ask sometimes after the list rather than above it.
  it('offers the choice list of a Claude-shaped reply', () => {
    const text = [
      'I traced the failure to two places:',
      '',
      '- `cache.ts` keeps a stale entry after a reconnect',
      '- `lock.ts` never releases on the error path',
      '',
      'Which should I fix first?',
      '',
      '1. **The stale cache** — one line, low risk',
      '2. **The held lock** — touches the error path',
      ''
    ].join('\n')
    const q = parseAgentQuestion(text)
    expect(q?.question).toBe('Which should I fix first?')
    expect(q?.optionTokens).toEqual(['1', '2'])
    expect(q?.options).toHaveLength(2)
  })

  it('keeps one Claude-shaped list whose question comes after it', () => {
    const text = [
      'I can take this two ways:',
      '',
      '1. Patch the parser',
      '2. Capture a real screen first',
      '',
      'Which do you want?'
    ].join('\n')
    const q = parseAgentQuestion(text)
    expect(q?.question).toBe('I can take this two ways')
    expect(q?.options).toEqual(['Patch the parser', 'Capture a real screen first'])
  })

  it('offers the choice list of a Codex-shaped reply of two bullet lists', () => {
    const text = [
      'Summary of what I checked:',
      '- tests pass on main',
      '- the flake reproduces with --shuffle',
      '',
      'Which way do you want to go?',
      '- Quarantine the flaky test',
      '- Fix the ordering dependency now'
    ].join('\n')
    const q = parseAgentQuestion(text)
    expect(q?.question).toBe('Which way do you want to go?')
    expect(q?.options).toEqual(['Quarantine the flaky test', 'Fix the ordering dependency now'])
    expect(formatQuestionAnswer(q!, ['Fix the ordering dependency now'])).toBe(
      'Fix the ordering dependency now'
    )
  })

  it('does not offer the sub-bullets under a choice as choices', () => {
    const text = [
      'Which approach?',
      '',
      '1. Clear the cache',
      '   - quick',
      '   - loses state',
      '2. Release the lock',
      '   - safer'
    ].join('\n')
    const q = parseAgentQuestion(text)
    expect(q?.options).toEqual(['Clear the cache', 'Release the lock'])
    expect(q?.optionTokens).toEqual(['1', '2'])
  })

  it('keeps a choice whose description wraps onto an indented line', () => {
    const q = parseAgentQuestion('Which?\n1. Clear\n   quick but lossy\n2. Release')
    expect(q?.options).toEqual(['Clear', 'Release'])
  })
})

describe('formatQuestionAnswer', () => {
  const numbered: MobileChatQuestion = {
    question: 'Pick',
    options: ['Alpha', 'Beta', 'Gamma'],
    multiSelect: false,
    optionTokens: ['1', '2', '3']
  }

  it('echoes the leading token for single-select', () => {
    expect(formatQuestionAnswer(numbered, ['Beta'])).toBe('2')
  })

  it('comma-joins tokens for multi-select', () => {
    const multi: MobileChatQuestion = { ...numbered, multiSelect: true }
    expect(formatQuestionAnswer(multi, ['Alpha', 'Gamma'])).toBe('1, 3')
  })

  it('sends the label text when the option had no token (bullet list)', () => {
    const bullets: MobileChatQuestion = {
      question: 'Pick',
      options: ['Rebase', 'Merge'],
      multiSelect: false,
      optionTokens: [null, null]
    }
    expect(formatQuestionAnswer(bullets, ['Merge'])).toBe('Merge')
  })

  it('echoes letter tokens', () => {
    const lettered: MobileChatQuestion = {
      question: 'Pick',
      options: ['Alpha', 'Beta'],
      multiSelect: false,
      optionTokens: ['a', 'b']
    }
    expect(formatQuestionAnswer(lettered, ['Beta'])).toBe('b')
  })

  it('passes free-text / unknown entries through verbatim', () => {
    expect(formatQuestionAnswer(numbered, ['something custom'])).toBe('something custom')
  })

  it('returns empty string when nothing is selected', () => {
    expect(formatQuestionAnswer(numbered, [])).toBe('')
    expect(formatQuestionAnswer(numbered, ['   '])).toBe('')
  })

  it('prefixes free-text answers with an opaque prompt token when provided', () => {
    expect(
      formatQuestionFreeTextAnswer({ ...numbered, freeTextToken: 'target' }, '  hi there  ')
    ).toBe(`target:${encodeURIComponent('hi there')}`)
  })
})

describe('mobileChatQuestionKey', () => {
  it('changes when a replacement prompt changes any positional content', () => {
    const first: MobileChatQuestion = {
      question: 'Pick',
      options: ['A', 'B'],
      multiSelect: true,
      optionTokens: ['1', '2']
    }
    expect(mobileChatQuestionKey({ ...first, options: ['A', 'C'] })).not.toBe(
      mobileChatQuestionKey(first)
    )
    expect(mobileChatQuestionKey({ ...first, freeTextToken: 'target-2' })).not.toBe(
      mobileChatQuestionKey(first)
    )
  })
})
