import { describe, expect, it } from 'vitest'
import {
  queuedMessagesFromScreen,
  pendingOutsideVisibleQueue
} from './mobile-terminal-queued-messages'
import { claudePermissionFromScreen } from './claude-terminal-permission'

describe('visible agent queue', () => {
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
