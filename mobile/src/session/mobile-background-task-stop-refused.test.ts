import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  backgroundShellLaunch,
  movedToBackgroundLaunch,
  taskStop
} from './fixtures/claude-orchestration-2.1.281'
import { readTaskEvidence } from './mobile-background-task-evidence'
import {
  deriveBackgroundTasks,
  type BackgroundTask,
  type BackgroundTaskHostStatus
} from './mobile-background-tasks'

// ─── A TaskStop the desk did not carry out ──────────────────────────────────
// The lead calls TaskStop on a running shell, and the user turns the
// permission prompt down, or the tool answers with an error. The shell keeps
// running on the desk. The phone read the call alone as the end of the task,
// so the row moved to Finished, left the running count, and the task memory
// kept the id as retired, until the shell's own notification landed (review,
// 2026-09-30).
//
// The launches and the stop that worked are the orchestration fixture's
// (session 967668df, Claude Code 2.1.281). The turn-down, the cancel and the
// denial are Claude Code's own sentences, and the not-running answer is the
// shape of TaskStop's input check in 2.1.283, as
// mobile-native-chat-created-file-running-work.test.ts pins them. Codex has
// no background task list on the phone and no TaskStop, so there is no Codex
// case to cover.

const NOW = Date.parse('2026-09-26T00:30:00.000Z')
const WORKING: BackgroundTaskHostStatus = { state: 'working', subagents: [] }

const USER_TURNED_DOWN =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."
const CANCELLED =
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed."
const DENIED =
  'Permission for this action was denied by the Claude Code auto mode classifier. Reason: Stopping a task the user started.'
const notRunning = (id: string, status: string) =>
  `<tool_use_error>Task ${id} is not running (status: ${status})</tool_use_error>`

// Verbatim in shape from Claude Code's transcripts (mobile-background-tasks.test.ts).
const shellNotification = (
  id: string,
  status = 'completed',
  summary = `Background command "[description of ${id}]" completed (exit code 0)`
) => `<task-notification>
<task-id>${id}</task-id>
<tool-use-id>toolu_01MYrD6JLqm1Z39124tyRFCy</tool-use-id>
<output-file>/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Walletify/98f20015-91ca-4aa2-a927-e971838f8a7f/tasks/${id}.output</output-file>
<status>${status}</status>
<summary>${summary}</summary>
</task-notification>`

let nextId = 0
function record(role: NativeChatMessage['role'], at: string, block: NativeChatMessage['blocks'][number]): NativeChatMessage {
  nextId += 1
  return { id: `stop-refused-${nextId}`, role, timestamp: Date.parse(at), source: 'transcript', blocks: [block] }
}

/** The lead's TaskStop call alone, as the fixture writes it. */
const stopCall = (id: string, at: string): NativeChatMessage => taskStop(id, at, at)[0]
const answered = (output: string, at: string, isError = false): NativeChatMessage =>
  record('tool', at, { type: 'tool-result', output, ...(isError ? { isError: true } : {}) })

const SHELL = backgroundShellLaunch('bshell1', '2026-09-26T00:10:00.000Z', '2026-09-26T00:10:00.412Z')
const ids = (tasks: readonly BackgroundTask[]) => tasks.map((task) => task.id)

describe('a TaskStop the desk did not carry out', () => {
  it('keeps a shell running, and out of the retired ids, when the user turned its stop down', () => {
    const messages = [
      ...SHELL,
      stopCall('bshell1', '2026-09-26T00:20:27.659Z'),
      answered(USER_TURNED_DOWN, '2026-09-26T00:20:31.004Z', true)
    ]
    const tasks = deriveBackgroundTasks(messages, NOW, WORKING)
    expect(ids(tasks.running)).toEqual(['bshell1'])
    expect(ids(tasks.finished)).toEqual([])
    expect(readTaskEvidence(messages).retiredTaskIds).toEqual([])
  })

  it.each([
    ['answered with a tool error: the task had not started', notRunning('bshell1', 'pending'), true],
    ['answered with a tool error about another task', notRunning('b0therid1', 'completed'), true],
    ['turned down, with no error mark on the answer', USER_TURNED_DOWN, false],
    ['cancelled by the user', CANCELLED, false],
    ['denied by the auto mode classifier', DENIED, false],
    ['marked an error in words the phone does not know', 'Stopping was blocked.', true]
  ])('keeps a shell running when its stop was %s', (_, output, isError) => {
    const messages = [
      ...SHELL,
      stopCall('bshell1', '2026-09-26T00:20:27.659Z'),
      answered(output, '2026-09-26T00:20:27.733Z', isError)
    ]
    expect(ids(deriveBackgroundTasks(messages, NOW, WORKING).running)).toEqual(['bshell1'])
    expect(readTaskEvidence(messages).retiredTaskIds).toEqual([])
  })

  it('keeps a shell running while its stop still waits on the permission prompt', () => {
    const messages = [...SHELL, stopCall('bshell1', '2026-09-26T00:20:27.659Z')]
    expect(ids(deriveBackgroundTasks(messages, NOW, WORKING).running)).toEqual(['bshell1'])
    expect(readTaskEvidence(messages).retiredTaskIds).toEqual([])
  })

  it('keeps a shell running when the user interrupted the turn before its stop answered', () => {
    const messages = [
      ...SHELL,
      stopCall('bshell1', '2026-09-26T00:20:27.659Z'),
      record('user', '2026-09-26T00:20:40.000Z', { type: 'text', text: '[Request interrupted by user for tool use]' })
    ]
    expect(ids(deriveBackgroundTasks(messages, NOW, WORKING).running)).toEqual(['bshell1'])
    expect(readTaskEvidence(messages).retiredTaskIds).toEqual([])
  })

  it('keeps a shell running when its stop was turned down beside a read answered first', () => {
    const messages = [
      ...SHELL,
      record('assistant', '2026-09-26T00:20:27.659Z', { type: 'tool-call', name: 'Read', input: { file_path: '/tmp/a.txt' } }),
      stopCall('bshell1', '2026-09-26T00:20:27.659Z'),
      answered('     1\tjobs', '2026-09-26T00:20:27.700Z'),
      answered(USER_TURNED_DOWN, '2026-09-26T00:20:31.004Z', true)
    ]
    expect(ids(deriveBackgroundTasks(messages, NOW, WORKING).running)).toEqual(['bshell1'])
    expect(readTaskEvidence(messages).retiredTaskIds).toEqual([])
  })

  it('retires a shell once, by the later stop, when the first stop of it was turned down', () => {
    const messages = [
      ...SHELL,
      ...backgroundShellLaunch('bshell2', '2026-09-26T00:11:00.000Z', '2026-09-26T00:11:00.388Z'),
      stopCall('bshell1', '2026-09-26T00:20:27.659Z'),
      answered(USER_TURNED_DOWN, '2026-09-26T00:20:31.004Z', true),
      record('user', '2026-09-26T00:22:00.000Z', { type: 'text', text: shellNotification('bshell2') }),
      ...taskStop('bshell1', '2026-09-26T00:24:10.120Z', '2026-09-26T00:24:10.190Z')
    ]
    const tasks = deriveBackgroundTasks(messages, NOW, WORKING)
    expect(ids(tasks.running)).toEqual([])
    // Newest first: the stop that went through came after bshell2's notification.
    expect(ids(tasks.finished)).toEqual(['bshell1', 'bshell2'])
    expect(readTaskEvidence(messages).retiredTaskIds).toEqual(['bshell2', 'bshell1'])
  })

  it('retires nothing for a stop that names no task, and still pairs the answers after it', () => {
    const messages = [
      ...SHELL,
      record('assistant', '2026-09-26T00:20:27.659Z', { type: 'tool-call', name: 'TaskStop', input: {} }),
      answered('Stopping was blocked.', '2026-09-26T00:20:27.733Z', true),
      ...backgroundShellLaunch('bshell2', '2026-09-26T00:21:00.000Z', '2026-09-26T00:21:00.388Z')
    ]
    expect(ids(deriveBackgroundTasks(messages, NOW, WORKING).running)).toEqual(['bshell1', 'bshell2'])
    expect(readTaskEvidence(messages).retiredTaskIds).toEqual([])
  })
})

describe('a TaskStop the desk carried out', () => {
  it('retires the shell, as the lead stopped bhcfbe9vf at 00:20:27', () => {
    const messages = [
      ...movedToBackgroundLaunch('bhcfbe9vf', '2026-09-25T23:24:54.203Z', '2026-09-25T23:26:57.378Z'),
      ...taskStop('bhcfbe9vf', '2026-09-26T00:20:27.659Z', '2026-09-26T00:20:27.733Z')
    ]
    const tasks = deriveBackgroundTasks(messages, NOW, WORKING)
    expect(ids(tasks.running)).toEqual([])
    expect(tasks.finished.map((task) => [task.id, task.status])).toEqual([['bhcfbe9vf', 'completed']])
    expect(readTaskEvidence(messages).retiredTaskIds).toEqual(['bhcfbe9vf'])
  })

  it.each(['completed', 'failed', 'killed'])('retires a shell its stop found already %s', (status) => {
    const messages = [
      ...SHELL,
      stopCall('bshell1', '2026-09-26T00:20:27.659Z'),
      answered(notRunning('bshell1', status), '2026-09-26T00:20:27.733Z', true)
    ]
    const tasks = deriveBackgroundTasks(messages, NOW, WORKING)
    expect(ids(tasks.running)).toEqual([])
    expect(ids(tasks.finished)).toEqual(['bshell1'])
    expect(readTaskEvidence(messages).retiredTaskIds).toEqual(['bshell1'])
  })

  // The stop now counts at its answer, not its call. A shell that failed on
  // its own while the stop waited has its notification between the two, and
  // the stop's not-running answer must not turn that failure into a stop.
  it("keeps a shell's own failure when it failed while its stop waited, and the stop found it ended", () => {
    const failure = 'Background command "./scripts/deploy.sh" failed with exit code 1'
    const messages = [
      ...SHELL,
      stopCall('bshell1', '2026-09-26T00:20:27.659Z'),
      record('user', '2026-09-26T00:20:29.000Z', { type: 'text', text: shellNotification('bshell1', 'failed', failure) }),
      answered(notRunning('bshell1', 'failed'), '2026-09-26T00:20:31.004Z', true)
    ]
    const tasks = deriveBackgroundTasks(messages, NOW, WORKING)
    expect(ids(tasks.running)).toEqual([])
    expect(tasks.finished.map((task) => [task.id, task.status, task.summary])).toEqual([['bshell1', 'failed', failure]])
  })

  it('orders a stopped shell among the finished by where its stop sits', () => {
    const messages = [
      ...SHELL,
      ...backgroundShellLaunch('bshell2', '2026-09-26T00:11:00.000Z', '2026-09-26T00:11:00.388Z'),
      ...taskStop('bshell1', '2026-09-26T00:20:27.659Z', '2026-09-26T00:20:27.733Z'),
      record('user', '2026-09-26T00:22:00.000Z', { type: 'text', text: shellNotification('bshell2') })
    ]
    expect(ids(deriveBackgroundTasks(messages, NOW, WORKING).finished)).toEqual(['bshell2', 'bshell1'])
  })
})
