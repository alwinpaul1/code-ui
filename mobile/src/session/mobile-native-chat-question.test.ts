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

  // This pinned null until 2026-09-30: the card took the reply's LAST list,
  // so a notes list after the choices dropped the card (review, 2026-09-30).
  it('keeps the card when a notes list follows the choice list', () => {
    const q = parseAgentQuestion(
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
    expect(q?.question).toBe('Which fix do you want?')
    expect(q?.options).toEqual(['Clear the cache', 'Release the lock'])
    expect(q?.optionTokens).toEqual(['1', '2'])
  })

  it('shows no card when the last list has no question directly above it', () => {
    // Prose that asks nothing.
    expect(
      parseAgentQuestion('Findings:\n- a\n- b\n\nI changed two files\n1. src/a.ts\n2. src/b.ts')
    ).toBeNull()
    // Another list, a blank line up.
    expect(
      parseAgentQuestion(
        'Findings so far:\n- the cache is stale\n- the lock is held\n\n1. Clear\n2. Release'
      )
    ).toBeNull()
    // Another list, directly above.
    expect(parseAgentQuestion('Which fix?\n- the cache\n1. Clear\n2. Release')).toBeNull()
  })

  it('shows no card when the reply asks two questions with a list each', () => {
    // Answering `2` would not say which question it answers.
    expect(
      parseAgentQuestion(
        'Which database?\n1. Postgres\n2. SQLite\n\nWhich ORM?\n1. Prisma\n2. Drizzle'
      )
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

// Reading the reply as lists ended a list at any prose at the list's own
// indent. A choice hard-wrapped to column 0, an unindented description under
// each choice, or a paragraph between the choices of a loose list split one
// list into several, the last had no question above it, and the card was lost.
describe('the question card for choices whose text sits at the list indent', () => {
  it('keeps both choices when a bullet wraps onto column 0', () => {
    const q = parseAgentQuestion(
      'Which branch?\n\n- main: the stable one that\nis wrapped at col 0\n- develop\n'
    )
    expect(q?.question).toBe('Which branch?')
    expect(q?.options).toEqual(['main: the stable one that', 'develop'])
    expect(q?.optionTokens).toEqual([null, null])
  })

  it('keeps both numbered choices when one wraps onto column 0', () => {
    const q = parseAgentQuestion(
      'Which?\n1. Option A which is a very long\nwrapped line\n2. Option B'
    )
    expect(q?.question).toBe('Which?')
    // A choice's label is its first line; the wrapped rest is not appended.
    expect(q?.options).toEqual(['Option A which is a very long', 'Option B'])
    expect(q?.optionTokens).toEqual(['1', '2'])
  })

  it('answers a wrapped bullet choice with its first line', () => {
    const q = parseAgentQuestion(
      'Which branch?\n\n- main: the stable one that\nis wrapped at col 0\n- develop\n'
    )!
    expect(formatQuestionAnswerByIndexes(q, [0])).toBe('main: the stable one that')
    expect(formatQuestionAnswerByIndexes(q, [1])).toBe('develop')
  })

  it('keeps both choices when each has an unindented description under it', () => {
    const q = parseAgentQuestion(
      'Which approach?\n\n1. Approach A\nThis one is quick.\n\n2. Approach B\nThis one is slow.'
    )
    expect(q?.question).toBe('Which approach?')
    expect(q?.options).toEqual(['Approach A', 'Approach B'])
    expect(q?.optionTokens).toEqual(['1', '2'])
  })

  it('keeps both choices of a loose numbered list with a paragraph under each', () => {
    const q = parseAgentQuestion(
      'Which do you prefer?\n\n1. Option A\n\nThis one is fast.\n\n2. Option B\n\nThis one is safe.'
    )
    expect(q?.question).toBe('Which do you prefer?')
    expect(q?.options).toEqual(['Option A', 'Option B'])
    expect(q?.optionTokens).toEqual(['1', '2'])
  })

  it('keeps both choices of a loose lettered list with a paragraph under each', () => {
    const q = parseAgentQuestion(
      'Which do you prefer?\n\na) Option A\n\nThis one is fast.\n\nb) Option B\n\nThis one is safe.'
    )
    expect(q?.options).toEqual(['Option A', 'Option B'])
    expect(q?.optionTokens).toEqual(['a', 'b'])
  })

  // Bullets carry no numbering to say the list goes on, and bridging the
  // paragraph would merge findings into the choices below them.
  it('shows no card for a loose bullet list with a paragraph between its choices', () => {
    expect(
      parseAgentQuestion(
        'Which do you prefer?\n\n- Option A\n\nThis one is fast.\n\n- Option B\n\nThis one is safe.'
      )
    ).toBeNull()
    expect(
      parseAgentQuestion(
        'Findings:\n\n- the cache is stale\n\nBoth need a fix eventually.\n\n- Clear the cache\n- Release the lock'
      )
    ).toBeNull()
  })

  it('does not join a paragraph across numbering that restarts or skips', () => {
    // Restarts: the second list is a new one under prose that asks nothing.
    expect(
      parseAgentQuestion(
        'Findings:\n\n1. the cache is stale\n\nThat is the root cause.\n\n1. Clear the cache\n2. Release the lock'
      )
    ).toBeNull()
    // Skips a number.
    expect(
      parseAgentQuestion('Which?\n\n1. Option A\n\nThis one is fast.\n\n3. Option C')
    ).toBeNull()
  })

  it('does not join a paragraph run straight into the next choice', () => {
    // No blank line between the paragraph and the next item: not a loose list.
    expect(parseAgentQuestion('Which?\n\n1. Option A\n\nThis one is fast.\n2. Option B')).toBeNull()
  })

  it('shows no card when a line that asks separates two numbered lists', () => {
    // The numbering goes on, but the second question makes it a second list.
    expect(
      parseAgentQuestion(
        'Which database?\n1. Postgres\n2. SQLite\n\nWhich ORM?\n\n3. Prisma\n4. Drizzle'
      )
    ).toBeNull()
    // A line that asks ends the first list even with no blank line before it.
    expect(
      parseAgentQuestion(
        'Which database?\n1. Postgres\n2. SQLite\nWhich ORM?\n3. Prisma\n4. Drizzle'
      )
    ).toBeNull()
  })

  it('takes a line that asks directly under the findings as the question, not a wrapped finding', () => {
    const numbered = parseAgentQuestion('- finding a\n- finding b\nWhich should I fix?\n1. a\n2. b')
    expect(numbered?.question).toBe('Which should I fix?')
    expect(numbered?.options).toEqual(['a', 'b'])
    expect(numbered?.optionTokens).toEqual(['1', '2'])
    const bullets = parseAgentQuestion('- finding a\n- finding b\nWhich should I fix?\n- a\n- b')
    expect(bullets?.question).toBe('Which should I fix?')
    expect(bullets?.options).toEqual(['a', 'b'])
  })

  it('keeps a single wrapped choice under a line that asks or introduces', () => {
    const asks = parseAgentQuestion('Apply the fix?\n1. Yes, apply it\nand restart the server')
    expect(asks?.question).toBe('Apply the fix?')
    expect(asks?.options).toEqual(['Yes, apply it'])
    const introduces = parseAgentQuestion(
      'Next step:\n- Restart the server\nonce the build is done'
    )
    expect(introduces?.question).toBe('Next step')
    expect(introduces?.options).toEqual(['Restart the server'])
  })

  it('keeps a single wrapped choice under a question after the findings', () => {
    const q = parseAgentQuestion(
      'Findings so far:\n- the cache is stale\n\nApply the fix?\n1. Yes, clear the cache\nand restart'
    )
    expect(q?.question).toBe('Apply the fix?')
    expect(q?.options).toEqual(['Yes, clear the cache'])
  })

  // The cost of reading a wrap: prose run straight on from a bullet with no
  // blank line is part of that bullet, as markdown draws it, so it cannot
  // introduce a second list of the same kind. The text cannot tell a wrapped
  // choice from an intro that neither asks nor ends in a colon.
  it('reads prose run straight on from a bullet as part of it, as markdown draws it', () => {
    const q = parseAgentQuestion('- a\n- b\nNow the choices\n- c\n- d')
    expect(q?.question).toBe('Choose an option')
    expect(q?.options).toEqual(['a', 'b', 'c', 'd'])
    // An intro that ends in a colon still starts a list of its own.
    expect(parseAgentQuestion('- a\n- b\nNow the choices:\n- c\n- d')).toBeNull()
  })

  it('keeps a wrap on the very last line of the reply', () => {
    const q = parseAgentQuestion('Which branch?\n- main\n- develop, which is\nwrapped')
    expect(q?.options).toEqual(['main', 'develop, which is'])
  })

  it('shows no card for a lone wrapped bullet or wrapped prose', () => {
    expect(parseAgentQuestion('Done.\n- one stray bullet\nwrapped at col 0')).toBeNull()
    expect(parseAgentQuestion('I wrapped this line\nat column 0 with no list.')).toBeNull()
    expect(parseAgentQuestion('')).toBeNull()
  })

  it('reads a multi-select hint from the chosen list, not a wrapped finding above it', () => {
    const findingHint = parseAgentQuestion(
      'Checked one or more caches:\n- a is stale and was\nwrapped\n\nWhich cache should I clear?\n1. a\n2. b'
    )
    expect(findingHint?.options).toEqual(['a', 'b'])
    expect(findingHint?.multiSelect).toBe(false)
    const questionHint = parseAgentQuestion(
      'Findings:\n- x\n\nSelect all that apply?\n1. Clear the cache and\nrestart\n2. Release the lock'
    )
    expect(questionHint?.options).toEqual(['Clear the cache and', 'Release the lock'])
    expect(questionHint?.multiSelect).toBe(true)
  })

  // Representative markdown, not captures: the parser reads the hook's
  // lastAssistantMessage, and agent CLIs may not be run from this shell.
  it('offers the choices of a Claude-shaped reply that hard-wraps them', () => {
    const text = [
      'I found two ways to fix the flaky upload test.',
      '',
      'Which should I do?',
      '',
      '1. **Retry the upload** — wrap the call in the existing retry helper so a',
      'transient 503 no longer fails the run',
      '2. **Mock the storage client** — faster, but the test stops covering the',
      'real network path',
      ''
    ].join('\n')
    const q = parseAgentQuestion(text)
    expect(q?.question).toBe('Which should I do?')
    expect(q?.optionTokens).toEqual(['1', '2'])
    expect(q?.options).toEqual([
      '**Retry the upload** — wrap the call in the existing retry helper so a',
      '**Mock the storage client** — faster, but the test stops covering the'
    ])
  })

  it('offers the choices of a Codex-shaped reply that hard-wraps them', () => {
    const text = [
      'Summary:',
      '- `upload.test.ts` fails about 1 in 20 runs on CI',
      '- the failure is a 503 from the storage emulator',
      '',
      'Which way do you want to go?',
      '- Retry the upload in the test helper so a transient 503 does not fail',
      'the run',
      '- Quarantine the test until the emulator is fixed'
    ].join('\n')
    const q = parseAgentQuestion(text)
    expect(q?.question).toBe('Which way do you want to go?')
    expect(q?.options).toEqual([
      'Retry the upload in the test helper so a transient 503 does not fail',
      'Quarantine the test until the emulator is fixed'
    ])
    expect(formatQuestionAnswerByIndexes(q!, [1])).toBe(
      'Quarantine the test until the emulator is fixed'
    )
  })
})

// The card read every `- ` and `1.` line as a choice, inside a code fence
// too. A fenced YAML file became the reply's last list: under prose that asks
// nothing it hid the real choices above it, and under its own `plugins:` key
// it was a card whose answers were YAML items (review, 2026-09-30).
// Representative markdown, not captures: the parser reads the hook's
// lastAssistantMessage, and agent CLIs may not be run from this shell.
describe('the question card for a reply that holds a code fence', () => {
  it('keeps the choices above a fenced file whose lines look like a list', () => {
    const q = parseAgentQuestion(
      'Which config do you want:\n1. Minimal\n2. Full\n\nFull looks like:\n```yaml\nplugins:\n- a\n- b\n```'
    )
    expect(q?.question).toBe('Which config do you want')
    expect(q?.options).toEqual(['Minimal', 'Full'])
    expect(q?.optionTokens).toEqual(['1', '2'])
  })

  it('offers no line inside a fence as an answer', () => {
    expect(
      parseAgentQuestion(
        'Here is the current file:\n```yaml\nplugins:\n- a\n- b\n```\nShould I keep it?'
      )
    ).toBeNull()
    expect(parseAgentQuestion('Run this:\n```\n- a\n- b\n```\nDone.')).toBeNull()
    expect(parseAgentQuestion('Run this:\n~~~\n1. a\n2. b\n~~~\nDone.')).toBeNull()
  })

  it('shows no card for a reply that is only a fence', () => {
    expect(parseAgentQuestion('```\n- a\n- b\n```')).toBeNull()
    expect(parseAgentQuestion('```sh\n1. a\n```')).toBeNull()
    expect(parseAgentQuestion('```')).toBeNull()
  })

  it('reads a fence that never closes as running to the end of the reply', () => {
    expect(parseAgentQuestion('Which one?\n```\n1. a\n2. b')).toBeNull()
    const q = parseAgentQuestion('Which one?\n1. A\n2. B\n\nFor example:\n```sh\n- a\n- b')
    expect(q?.options).toEqual(['A', 'B'])
    expect(q?.optionTokens).toEqual(['1', '2'])
  })

  it('closes a longer fence only on a run at least as long', () => {
    // A four-backtick fence holding a three-backtick line: all of it is code.
    expect(parseAgentQuestion('Here is the doc:\n````md\n```\n- a\n- b\n````\nDone.')).toBeNull()
    // A closing run longer than the opener closes it; an info string does not.
    expect(parseAgentQuestion('Example:\n```\n```sh\n- a\n- b\n`````\nDone.')).toBeNull()
    const q = parseAgentQuestion('Example:\n````\n```\n- a\n````\n\nWhich one?\n1. A\n2. B')
    expect(q?.question).toBe('Which one?')
    expect(q?.options).toEqual(['A', 'B'])
  })

  it('keeps the choices around a fence indented under one of them (Claude-shaped)', () => {
    const q = parseAgentQuestion(
      [
        'Which approach?',
        '',
        '1. Run the script',
        '   ```sh',
        '   - not a choice',
        '   2. nor this',
        '   ```',
        '2. Edit by hand'
      ].join('\n')
    )
    expect(q?.question).toBe('Which approach?')
    expect(q?.options).toEqual(['Run the script', 'Edit by hand'])
    expect(q?.optionTokens).toEqual(['1', '2'])
  })

  it('keeps the choices around a fence indented under one of them (Codex-shaped)', () => {
    const q = parseAgentQuestion(
      [
        'Which way do you want to go?',
        '- **Pin the plugin** in `config.yaml`:',
        '  ```yaml',
        '  plugins:',
        '  - a@1.2.3',
        '  ```',
        '- **Leave the range** and accept the update'
      ].join('\n')
    )
    expect(q?.question).toBe('Which way do you want to go?')
    expect(q?.options).toEqual([
      '**Pin the plugin** in `config.yaml`:',
      '**Leave the range** and accept the update'
    ])
    expect(q?.optionTokens).toEqual([null, null])
  })

  it('keeps a numbered list going past a fence between its choices, as past a paragraph', () => {
    const q = parseAgentQuestion(
      'Which one?\n\n1. Run the script:\n\n```sh\n- ./fix.sh\n```\n\n2. Edit by hand'
    )
    expect(q?.options).toEqual(['Run the script:', 'Edit by hand'])
    expect(q?.optionTokens).toEqual(['1', '2'])
  })

  it('takes no fence line as the title of the list under it', () => {
    const q = parseAgentQuestion('```sh\nnpm test\n```\n1. Alpha\n2. Beta')
    expect(q?.question).toBe('Choose an option')
    expect(q?.options).toEqual(['Alpha', 'Beta'])
  })
})

// The bullet pattern took `> ` as a marker and `* * *` as a bullet holding
// `* *`, so a quoted error became a card of its lines and a rule became a
// choice. The parser reads the agent's Markdown reply (the hook's
// lastAssistantMessage), where `>` is a blockquote, never a TUI pointer.
describe('the question card for a reply that quotes or draws a rule', () => {
  it('offers no quoted line as an answer (Claude-shaped)', () => {
    expect(
      parseAgentQuestion(
        'The error says:\n> connection refused\n> retry later\n\nDo you want me to look into it further'
      )
    ).toBeNull()
    expect(
      parseAgentQuestion('The error says:\n> foo failed\n> bar failed\n\nI fixed it.')
    ).toBeNull()
  })

  it('offers no quoted line as an answer (Codex-shaped)', () => {
    expect(
      parseAgentQuestion(
        '**Error**:\n> connection refused\n> at connect (net.js:1:1)\n\nWant me to dig into it?'
      )
    ).toBeNull()
  })

  it('shows no card for a rule, spaced as Claude or Codex draws it', () => {
    expect(parseAgentQuestion('Which one?\n\n* * *\n\nNo options here')).toBeNull()
    expect(parseAgentQuestion('Which one?\n\n- - -\n\nNo options here')).toBeNull()
    expect(parseAgentQuestion('Which one?\n1. ---')).toBeNull()
  })

  it('keeps a choice whose text holds marks among its words', () => {
    const q = parseAgentQuestion('Which path?\n- *fast* path\n- **safe** path\n- -1 offset')
    expect(q?.options).toEqual(['*fast* path', '**safe** path', '-1 offset'])
  })

  it('keeps the choices under a question after a quote', () => {
    const q = parseAgentQuestion(
      'The test fails with:\n\n> Error: connection refused\n\nWhich should I do?\n\n1. Retry\n2. Skip'
    )
    expect(q?.question).toBe('Which should I do?')
    expect(q?.options).toEqual(['Retry', 'Skip'])
  })
})

// The card took the reply's last list, so a list of reasons or notes after
// the choices became "the options" with no question above them, and the card
// vanished (review, 2026-09-30). The choices are the one list under the line
// that asks; its title, markers and multi-select hint are that list's.
describe('the question card for choices followed by a list of reasons or notes', () => {
  it('keeps the choices when a reasons list follows them (Claude-shaped)', () => {
    const q = parseAgentQuestion(
      'Which one?\n\n1. A\n2. B\n\nI recommend option 1 because:\n- fast\n- simple'
    )
    expect(q?.question).toBe('Which one?')
    expect(q?.options).toEqual(['A', 'B'])
    expect(q?.optionTokens).toEqual(['1', '2'])
    expect(formatQuestionAnswerByIndexes(q!, [1])).toBe('2')
  })

  it('keeps the choices when a reasons list follows them (Codex-shaped)', () => {
    const q = parseAgentQuestion(
      [
        'Which way do you want to go?',
        '- **Quarantine** the flaky test',
        '- **Fix** the ordering dependency now',
        '',
        'I lean to the second because:',
        '- it is a one-line change',
        '- the flake hides a real bug'
      ].join('\n')
    )
    expect(q?.question).toBe('Which way do you want to go?')
    expect(q?.options).toEqual([
      '**Quarantine** the flaky test',
      '**Fix** the ordering dependency now'
    ])
    expect(q?.optionTokens).toEqual([null, null])
  })

  it('keeps the choices between a findings list and a notes list', () => {
    const q = parseAgentQuestion(
      'Findings:\n- x is stale\n- y is held\n\nWhich should I fix?\na) x\nb) y\n\nNotes:\n1. both are safe\n2. neither needs a restart'
    )
    expect(q?.question).toBe('Which should I fix?')
    expect(q?.options).toEqual(['x', 'y'])
    expect(q?.optionTokens).toEqual(['a', 'b'])
  })

  it('reads a multi-select hint from the chosen list, not the notes after it', () => {
    const notesHint = parseAgentQuestion(
      'Which cache should I clear?\n1. a\n2. b\n\nNotes:\n- one or more of them may rebuild'
    )
    expect(notesHint?.options).toEqual(['a', 'b'])
    expect(notesHint?.multiSelect).toBe(false)
    const ownHint = parseAgentQuestion(
      'Which caches should I clear? Select all that apply?\n1. a\n2. b\n\nNotes:\n- a is big'
    )
    expect(ownHint?.options).toEqual(['a', 'b'])
    expect(ownHint?.multiSelect).toBe(true)
  })

  it('reads no multi-select hint from a code fence', () => {
    const q = parseAgentQuestion(
      'Which one?\n1. A\n2. B\n\nThe config takes:\n```\nids: one or more, comma-separated\n```'
    )
    expect(q?.options).toEqual(['A', 'B'])
    expect(q?.multiSelect).toBe(false)
  })

  it('keeps a single choice under a line that asks with notes after it', () => {
    const q = parseAgentQuestion('Apply the fix?\n1. Yes, clear the cache\n\nNotes:\n- it is safe')
    expect(q?.question).toBe('Apply the fix?')
    expect(q?.options).toEqual(['Yes, clear the cache'])
  })

  it('shows no card when no list, or more than one, sits under a line that asks', () => {
    expect(parseAgentQuestion('Done:\n- a\n- b\n\nNotes:\n- c\n- d')).toBeNull()
    expect(parseAgentQuestion('Which one?\n1. A\n2. B\n\nWhich order?\n- first\n- last')).toBeNull()
    expect(parseAgentQuestion('No lists here, only prose.')).toBeNull()
  })

  it('shows no card when a later list may be more of the choices', () => {
    // No line of its own above it: the question may cover it too.
    expect(parseAgentQuestion('Which one?\n1. A\n2. B\n- C\n- D')).toBeNull()
    // Prose that introduces nothing: a description the numbering did not bridge.
    expect(parseAgentQuestion('Which one?\n\n1. A\n2. B\n\nBoth work.\n\n4. D')).toBeNull()
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
