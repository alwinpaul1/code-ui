import { describe, expect, it } from 'vitest'
import { styleText } from './notification-plain-text'
import { presentDesktopNotification } from './notification-presentation'
import { NOTIFICATION_STATUS_ICONS } from './notification-status-icon'

// Captured from the Galaxy S23 notification shade on 2026-09-09 (Orca 1.4.197):
//   title  "Code UI / Code UI - Claude finished"
//   body   the agent's whole Markdown summary, asterisks and backticks included
describe('desktop notifications read like a modern app', () => {
  it('names Grok when the desktop titled a Grok turn as Claude finished', () => {
    const presented = presentDesktopNotification({
      source: 'agent-task-complete',
      title: 'Code UI / Code UI - Claude finished',
      body: 'That lower pane is not a second Orca session.',
      agent: 'grok'
    })
    expect(presented.title).toBe('Code UI · Grok finished')
  })

  it('names Codex the same way when the desktop titled a Codex turn as Claude', () => {
    const presented = presentDesktopNotification({
      source: 'agent-task-complete',
      title: 'nexos / main - Claude finished',
      body: 'Shipped the parser.',
      agent: 'codex'
    })
    expect(presented.title).toBe('nexos / main · Codex finished')
  })

  it('leads with the project, then what the agent did, and keeps a short styled summary', () => {
    const presented = presentDesktopNotification({
      source: 'agent-task-complete',
      title: 'Code UI / Code UI - Claude finished',
      body: '**Fixed** the queue parser in `native-queue-input.ts`. Two tests cover it.'
    })
    expect(presented.title).toBe('Code UI · Claude finished')
    expect(presented.body).toBe(
      `${styleText('Fixed', 'bold')} the queue parser in ${styleText('native-queue-input.ts', 'mono')}. Two tests cover it.`
    )
  })

  it('keeps repo and worktree when they differ', () => {
    const presented = presentDesktopNotification({
      source: 'agent-task-complete',
      title: 'nexos / feature/route-planner - Codex needs your input',
      body: 'Allow `rm -rf dist`?'
    })
    expect(presented.title).toBe('nexos / feature/route-planner · Codex needs your input')
    expect(presented.body).toBe(`Allow ${styleText('rm -rf dist', 'mono')}?`)
  })

  it('drops a body that only repeats the headline', () => {
    const presented = presentDesktopNotification({
      source: 'agent-task-complete',
      title: 'Code UI / Code UI - Claude finished',
      body: 'Claude finished.'
    })
    expect(presented).toEqual({
      title: 'Code UI · Claude finished',
      body: '',
      statusIcon: NOTIFICATION_STATUS_ICONS.done
    })
  })

  it('trims a long summary at a sentence boundary', () => {
    const long = `${'First sentence of the summary. '.repeat(8)}Then a very long tail ${'x'.repeat(400)}`
    const presented = presentDesktopNotification({
      source: 'agent-task-complete',
      title: 'Code UI - Claude finished',
      body: long
    })
    expect(presented.body.length).toBeLessThanOrEqual(322)
    expect(presented.body.endsWith('.…')).toBe(true)
  })

  it('passes an unfamiliar title through as plain text', () => {
    const presented = presentDesktopNotification({
      source: 'terminal-bell',
      title: 'Terminal bell',
      body: 'make: *** [all] Error 2'
    })
    expect(presented.title).toBe('Terminal bell')
    expect(presented.body).toBe('make: *** [all] Error 2')
  })

  // 2026-09-24, the user: no emoji in a notification; a drawn icon in its place.
  // The title keeps its words, and the kind of news rides along for the native
  // view to draw where the emoji used to sit.
  it('writes no emoji in a title, and names the icon drawn in its place', () => {
    const cases = [
      ['agent-task-complete', 'nexos / main - Claude finished', NOTIFICATION_STATUS_ICONS.done],
      ['agent-task-complete', 'nexos / main - Codex needs your input', NOTIFICATION_STATUS_ICONS.question],
      ['agent-task-complete', 'nexos / main - Claude is waiting for permission', NOTIFICATION_STATUS_ICONS.question],
      ['terminal-bell', 'nexos / main - Terminal bell', NOTIFICATION_STATUS_ICONS.bell],
      ['test', 'Test notification', null]
    ] as const
    for (const [source, title, icon] of cases) {
      const presented = presentDesktopNotification({ source, title, body: '' })
      expect(presented.title).not.toMatch(/\p{Extended_Pictographic}/u)
      expect(presented.statusIcon).toBe(icon)
    }
  })
})
