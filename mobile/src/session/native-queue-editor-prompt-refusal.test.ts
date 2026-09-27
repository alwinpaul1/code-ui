import { expect, it, vi } from 'vitest'
import { submitInput } from './native-queue-input'
import { finishNativeQueueEdit, QueueRebuildError, type QueueScreen } from './native-queue-editor'

// What a queue edit says when a real prompt comes up part-way through it, once
// a key has already taken messages out of the queue. Split from
// native-queue-editor.test.ts, at its max-lines ceiling.

const screen = (draft = '', lines: string[] = []): QueueScreen => ({ source: 'screen', draft, lines })
// Claude's legacy recall: the whole queue as one draft (native-queue-editor.test.ts).
const LEGACY_DRAFT = 'alpha first\nbravo second\ncharlie third'

// A live 2.1.276 Bash dialog (mobile-native-chat-permission-send.test.ts), as
// it would come up in the middle of a queue edit.
const PROMPT_UP = screen('', [
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. No',
  '',
  ' Esc to cancel · Tab to amend'
])

it('does not contradict itself when a prompt stops a rebuild', async () => {
  const reads = [screen(LEGACY_DRAFT), PROMPT_UP]
  const failure = await finishNativeQueueEdit(
    { read: async () => reads.shift() ?? PROMPT_UP, write: vi.fn().mockResolvedValue(undefined), pause: async () => {} },
    'claude',
    { text: 'bravo second', draft: LEGACY_DRAFT, segments: ['alpha first', 'bravo second', 'charlie third'], index: 1 },
    'bravo EDITED'
  ).catch((cause: unknown) => cause)
  expect(failure).toBeInstanceOf(QueueRebuildError)
  const said = (failure as Error).message
  expect(said).toMatch(/^A prompt came up on the desktop\. 3 messages left the queue and are not on the agent\./)
  expect(said).not.toMatch(/in the agent input/)
})

// After its Enter the message may have gone into the queue or still be in the
// input: the refusal cannot say which.
it('says the message may be in the input or still queued when a prompt comes up after its Enter', async () => {
  const write = vi.fn().mockResolvedValue(undefined)
  await expect(
    submitInput({ read: async () => PROMPT_UP, write, pause: async () => {} }, 'claude', 'ping', true)
  ).rejects.toThrow('A prompt came up on the desktop. The message may be in the agent input or still queued.')
  expect(write).toHaveBeenCalledExactlyOnceWith('\r')
})

// A prompt that comes up just after one part's Enter leaves that part in the
// input or already in the agent's queue. Calling it "not on the agent" sent
// the user to queue it again (final check, 2026-09-27).
it('does not call a rebuilt message lost when a prompt comes up just after its Enter', async () => {
  const reads = [screen(LEGACY_DRAFT), screen('')]
  const failure = await finishNativeQueueEdit(
    { read: async () => reads.shift() ?? PROMPT_UP, write: vi.fn().mockResolvedValue(undefined), pause: async () => {} },
    'claude',
    { text: 'bravo second', draft: LEGACY_DRAFT, segments: ['alpha first', 'bravo second', 'charlie third'], index: 1 },
    'bravo EDITED'
  ).catch((cause: unknown) => cause)
  expect(failure).toBeInstanceOf(QueueRebuildError)
  const said = (failure as Error).message
  expect(said).toContain('The message may be in the agent input or still queued.')
  expect(said).toContain('3 messages left the queue.')
  expect(said).not.toMatch(/not on the agent/)
})
