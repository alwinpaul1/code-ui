import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { deriveBackgroundTasks } from './mobile-background-tasks'

// A Monitor was read as a background SHELL: the card drew it as "Shell" with the terminal glyph, and
// the footer fit counted it against the footer's "N shells", so a monitor and one shell under a
// footer reading "1 shell" retired the monitor as finished while it still ran (review, 2026-09-30).
// Claude Code calls it a monitor itself (the Stop hook's `background_tasks` entry has type
// "monitor"), and its footer pill counts monitors apart from shells ("N shells, M monitors", or
// "N background tasks" for a mix: the 2.1.284 binary, docs/mobile-background-tasks.md). No real
// screen of that pill has been captured, so while a monitor runs the phone does not fit anything to
// the footer's count.
//
// The tool results are verbatim from this machine's transcripts (mobile-background-tasks.test.ts:
// the Monitor result 2026-09-09, the Bash one 2026-09-09, Claude Code 2.x).
const monitorStartOutput = (id: string) =>
  `Monitor started (task ${id}, timeout 3000000ms). You will be notified on each event. Keep working — do not poll or sleep. Events may arrive while you are waiting for the user — an event is not their reply.`
const shellStartOutput = (id: string) =>
  `Command running in background with ID: ${id}. Output is being written to: /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Walletify/98f20015-91ca-4aa2-a927-e971838f8a7f/tasks/${id}.output. You will be notified when it completes. To check interim output, use Read on that file path.`
const endedNotification = (id: string, summary: string) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>${summary}</summary>\n</task-notification>`

let nextId = 0
function message(role: 'assistant' | 'user', timestamp: number, block: NativeChatMessage['blocks'][number]): NativeChatMessage {
  nextId += 1
  return { id: `m-${nextId}`, role, timestamp, source: 'transcript', blocks: [block] }
}
const launch = (name: string, input: unknown, output: string, at: number): NativeChatMessage[] => [
  message('assistant', at, { type: 'tool-call', name, input }),
  message('user', at + 500, { type: 'tool-result', output })
]

const T0 = Date.UTC(2026, 8, 30, 12, 0, 0)
const NOW = T0 + 5 * 60_000
const WORKING = { state: 'working' as const, subagents: [] }
const monitor = (id = 'bmon12345', at = T0) =>
  launch('Monitor', { command: 'tail -f build.log', description: 'Watch the build log' }, monitorStartOutput(id), at)
const shell = (id: string, at: number) =>
  launch('Bash', { command: 'pnpm test', description: `Run the tests ${id}`, run_in_background: true }, shellStartOutput(id), at)

describe('a Monitor on the background-task card', () => {
  it('is a monitor, not a shell', () => {
    const tasks = deriveBackgroundTasks(monitor(), NOW)
    expect(tasks.running).toEqual([expect.objectContaining({ id: 'bmon12345', kind: 'monitor', title: 'Watch the build log' })])
  })

  it('keeps running beside a shell under a footer that counts that one shell', () => {
    const tasks = deriveBackgroundTasks([...monitor(), ...shell('bshell123', T0 + 60_000)], NOW, WORKING, { onScreenShellCount: 1 })
    expect(tasks.running.map((task) => [task.id, task.kind])).toEqual([
      ['bmon12345', 'monitor'],
      ['bshell123', 'shell']
    ])
    expect(tasks.finished).toEqual([])
  })
})

describe("the footer's shell count while a Monitor runs", () => {
  it('retires no shell from a count lower than the shells named', () => {
    const messages = [...monitor(), ...shell('bshell1', T0 + 60_000), ...shell('bshell2', T0 + 120_000)]
    const tasks = deriveBackgroundTasks(messages, NOW, WORKING, { onScreenShellCount: 1 })
    expect(tasks.running.map((task) => task.id)).toEqual(['bmon12345', 'bshell1', 'bshell2'])
    // Nor from a held reading once the footer has left the screen.
    const held = deriveBackgroundTasks(messages, NOW, WORKING, {
      onScreenShellCount: null,
      heldOnScreenShellCount: { count: 0, at: NOW }
    })
    expect(held.running.map((task) => task.id)).toEqual(['bmon12345', 'bshell1', 'bshell2'])
  })

  it('pads no unnamed shell for a monitor alone under a count of one', () => {
    const tasks = deriveBackgroundTasks(monitor(), NOW, WORKING, { onScreenShellCount: 1 })
    expect(tasks.running.map((task) => task.id)).toEqual(['bmon12345'])
  })

  it('fits the shells to the count again once the monitor has ended', () => {
    const messages = [
      ...monitor(),
      ...shell('bshell1', T0 + 60_000),
      ...shell('bshell2', T0 + 120_000),
      message('user', T0 + 180_000, { type: 'text', text: endedNotification('bmon12345', 'Monitor "Watch the build log" stream ended') })
    ]
    const tasks = deriveBackgroundTasks(messages, NOW, WORKING, { onScreenShellCount: 1 })
    expect(tasks.running.map((task) => task.id)).toEqual(['bshell2'])
    expect(tasks.finished.map((task) => [task.id, task.status])).toEqual([
      ['bshell1', 'finished'],
      ['bmon12345', 'completed']
    ])
  })

  it('reads an empty transcript under a count of zero as nothing running', () => {
    expect(deriveBackgroundTasks([], NOW, WORKING, { onScreenShellCount: 0 })).toEqual({ running: [], finished: [] })
  })
})
