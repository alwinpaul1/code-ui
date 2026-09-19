import { expect, it } from 'vitest'
import { sameEntry, sameText, segmentRecalledQueue } from './native-queue-input'

// The queue editor confirms a recall by matching the draft it typed against
// the caption Claude draws, and Claude draws inline code without its
// backticks (queue box, Claude Code 2.1.278). A message with inline code could
// therefore never be confirmed as its own entry (2026-09-19).
const typed = 'written as a `user` row with `turnOrigin: "scheduled"` inside'
const painted = 'written as a user row with turnOrigin:\n"scheduled" inside'

it('confirms a recalled entry whose inline code was painted without backticks', () => {
  expect(sameText(typed, painted)).toBe(true)
  expect(sameEntry(typed, painted)).toBe(true)
  expect(sameEntry(typed, 'written as a user row with…')).toBe(true)
})

it('still tells two different entries apart', () => {
  expect(sameText(typed, 'written as a user row with turnOrigin: "human" inside')).toBe(false)
  expect(sameEntry(typed, 'something else entirely')).toBe(false)
})

// Review (2026-09-19): stripping backticks made an all-backtick draft empty,
// and an empty side matched anything.
it('never matches a draft that is nothing but backticks', () => {
  expect(sameEntry('```', 'something else entirely')).toBe(false)
  expect(sameText('```', '   ')).toBe(false)
  expect(sameEntry('', 'x')).toBe(false)
})

// The whole-queue recall (stock Claude Code's default path) segments the
// recalled draft against the captions the box drew before it, and the
// captions have no backticks while the draft keeps them.
it('segments a recalled queue whose message had inline code', () => {
  expect(
    segmentRecalledQueue('first message here\nrun `npm test` and report', [
      'first message here',
      'run npm test and report'
    ])
  ).toEqual(['first message here', 'run `npm test` and report'])
  // A segment that starts or ends on a backtick keeps it.
  expect(segmentRecalledQueue('`a`\n`b c`', ['a', 'b c'])).toEqual(['`a`', '`b c`'])
  // Adjacent messages with no newline between still refuse.
  expect(segmentRecalledQueue('a`b', ['a', 'b'])).toBeNull()
})
