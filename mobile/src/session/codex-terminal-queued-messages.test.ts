import { describe, expect, it } from 'vitest'
import { codexQueuedMessagesFromScreen } from './codex-terminal-queued-messages'

describe('Codex visible pending inputs', () => {
  it('reads desktop follow-ups, wrapped lines and repeated entries in order', () => {
    expect(
      codexQueuedMessagesFromScreen([
        '• Queued follow-up inputs',
        '  ↳ desktop task',
        '    wrapped continuation',
        '  ↳ mobile task',
        '  ↳ mobile task',
        '    alt + ↑ edit last queued message',
        '› unsent composer draft'
      ])
    ).toEqual(['desktop task\nwrapped continuation', 'mobile task', 'mobile task'])
  })
  it('includes pending steers and end-of-turn retries while preserving truncation', () => {
    expect(
      codexQueuedMessagesFromScreen([
        '• Messages to be submitted after next tool call (press esc',
        '  to interrupt and send immediately)',
        '  ↳ steer from phone',
        '',
        '• Messages to be submitted at end of turn',
        '  ↳ retry this',
        '',
        '• Queued follow-up inputs',
        '  ↳ long queued message',
        '    second line',
        '    third line',
        '    …',
        '    alt + ↑ edit last queued message'
      ])
    ).toEqual(['steer from phone', 'retry this', 'long queued message\nsecond line\nthird line\n…'])
  })
  it('reads headers wrapped by a narrow desktop terminal', () => {
    expect(
      codexQueuedMessagesFromScreen([
        '• Messages to be submitted after',
        '  next tool call (press esc to',
        '  interrupt and send immediately)',
        '  ↳ wait for the next result'
      ])
    ).toEqual(['wait for the next result'])
  })

  it('ignores drafts, ordinary arrows and empty question-only groups', () => {
    expect(codexQueuedMessagesFromScreen(['› my draft', '  ↳ ordinary output'])).toEqual([])
    expect(
      codexQueuedMessagesFromScreen(['• Queued follow-up inputs', '  Question 1 of 2', '› choice'])
    ).toEqual([])
    expect(codexQueuedMessagesFromScreen(['Working…'])).toEqual([])
  })
})

it('reads the unbulleted queue layout shown in the desktop screenshot', () => {
  expect(
    codexQueuedMessagesFromScreen([
      'Queued follow-up inputs',
      '↳ /var/folders/0y/session/T/orca-paste-1788712836417-a0492b73-30c3-4c2f-9f7c-c9b7ca928614.png Same',
      '  message seen as duplicate fix that',
      '↳ second image and caption',
      '  ⌥ + ↑ edit last queued message'
    ])
  ).toEqual([
    '/var/folders/0y/session/T/orca-paste-1788712836417-a0492b73-30c3-4c2f-9f7c-c9b7ca928614.png Same\nmessage seen as duplicate fix that',
    'second image and caption'
  ])
})
