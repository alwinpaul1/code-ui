import { describe, expect, it } from 'vitest'
import {
  queuedMessagesFromScreen,
  pendingOutsideVisibleQueue,
  projectMobileChatQueue
} from './mobile-terminal-queued-messages'
import { claudePermissionFromScreen } from './claude-terminal-permission'

describe('visible agent queue', () => {
  it.each([
    ['❯ Press up to select a queued message, then Enter to edit it'],
    ['❯ Press up to select a queued message to edit, or Enter to send them now'],
    ['❯ Press up to select a queued message, then Enter', '  to edit it']
  ])('reads the newer Claude queue selector hint: %s', (...footer) => {
    expect(
      queuedMessagesFromScreen([
        '⏺ Earlier response',
        '',
        '✻ Working…',
        '',
        '❯ desktop follow-up',
        '  with wrapped text',
        '────────',
        ...footer
      ])
    ).toEqual(['desktop follow-up\nwith wrapped text'])
  })
  it('reads the explicit queue and wrapped text without importing history', () => {
    expect(
      queuedMessagesFromScreen([
        '❯ old prompt',
        '',
        '✻ Calculating…',
        '',
        '❯ run on Willi',
        '  and test and confirm',
        '❯ another task',
        '────────',
        '❯ Press up to edit queued messages'
      ])
    ).toEqual(['run on Willi\nand test and confirm', 'another task'])
  })
  it('ignores normal composer drafts and removes entries when the footer disappears', () => {
    expect(queuedMessagesFromScreen(['❯ unsent draft'])).toEqual([])
    expect(queuedMessagesFromScreen(['Running queued task'])).toEqual([])
  })
  it('deduplicates by occurrence without dropping repeated or unconfirmed mobile messages', () => {
    const pending = [
      { text: 'hello', id: 1 },
      { text: 'hello', id: 2 },
      { text: 'new', id: 3 }
    ]
    expect(pendingOutsideVisibleQueue(pending, ['hello'])).toEqual(pending.slice(1))
  })
})

describe('Claude live approval', () => {
  const screen = [
    'Bash command',
    '  echo hello',
    'Do you want to proceed?',
    '❯ 1. Yes',
    '  2. Yes, and don’t ask again for: echo hello',
    '  3. No',
    'Esc to cancel · Tab to amend'
  ]
  it('retains the complete command and exact choices', () => {
    expect(claudePermissionFromScreen(screen)).toMatchObject({
      title: 'Allow Bash?',
      options: [
        { label: 'Yes', send: '1' },
        { label: 'Yes, and don’t ask again for: echo hello', send: '2' },
        { label: 'No', send: '3' }
      ]
    })
    expect(claudePermissionFromScreen(screen)?.detail).toContain('echo hello')
  })
  it('rejects unselected history and incomplete dialogs', () => {
    expect(claudePermissionFromScreen(screen.map((x) => x.replace('❯ ', '')))).toBeNull()
    expect(claudePermissionFromScreen(screen.slice(0, -1))).toBeNull()
  })
})

it('renders a queued image and caption once with its local thumbnail instead of path text', () => {
  const image = { text: 'See this', images: ['file:///a.jpg'], id: 1 }
  const path =
    '/var/folders/0y/session/T/orca-paste-1788707946740-fd6147a9-5b2d-4051-8a87-dbd45992c21e.png'
  expect(projectMobileChatQueue([image], [path + ' See this', 'unrelated'])).toEqual({
    pending: [],
    queue: [{ text: image.text, images: image.images }, 'unrelated']
  })
  expect(
    projectMobileChatQueue([image], [path + ' See this', path + ' See this']).queue
  ).toHaveLength(2)
})

it('keeps both queue entries when a photo and another message repeat a caption', () => {
  const image = { text: 'See this', images: ['file:///a.jpg'], id: 1 }
  expect(projectMobileChatQueue([image], ['[Image #1] See this', 'See this'])).toEqual({
    pending: [],
    queue: [{ text: image.text, images: image.images }, 'See this']
  })
})
