// The agent's input as the queue read reports it beside the box: what tells a
// queued message recalled for editing from one the agent took (queue-recalls.ts,
// 2026-10-15). Screens: fixtures/queued-tap-recall-2.1.296-0.153.4.ts, with the
// `draft` Orca publishes (Claude Code 2.1.296, Codex 0.153.4).

import { describe, expect, it } from 'vitest'
import { queueBoxReadFromScreen } from './mobile-terminal-queue-read'
import {
  CLAUDE_ONE_QUEUED_2_1_296,
  CLAUDE_ONE_RECALLED_2_1_296,
  CLAUDE_QUEUED_TEXT,
  CODEX_ONE_QUEUED_0_153_4,
  CODEX_ONE_RECALLED_0_153_4,
  CODEX_QUEUED_TEXT
} from './fixtures/queued-tap-recall-2.1.296-0.153.4'

describe('the agent input beside the queue box', () => {
  it('reads Claude Code 2.1.296 queue placeholder as an empty input and a recalled message as its words', () => {
    expect(queueBoxReadFromScreen(CLAUDE_ONE_QUEUED_2_1_296, 'claude', 'Press up to edit queued messages').input).toBe('')
    expect(queueBoxReadFromScreen(CLAUDE_ONE_RECALLED_2_1_296, 'claude', CLAUDE_QUEUED_TEXT).input).toBe(CLAUDE_QUEUED_TEXT)
  })

  it('reads Codex 0.153.4 empty composer as an empty input and a recalled message as its words', () => {
    expect(queueBoxReadFromScreen(CODEX_ONE_QUEUED_0_153_4, 'codex', '').input).toBe('')
    expect(queueBoxReadFromScreen(CODEX_ONE_RECALLED_0_153_4, 'codex', CODEX_QUEUED_TEXT).input).toBe(CODEX_QUEUED_TEXT)
  })

  it('reports no input where Orca published no draft or the agent has no box reader', () => {
    expect(queueBoxReadFromScreen(CLAUDE_ONE_RECALLED_2_1_296, 'claude', undefined).input).toBe('')
    expect(queueBoxReadFromScreen(CODEX_ONE_RECALLED_0_153_4, 'gemini', CODEX_QUEUED_TEXT).input).toBe('')
  })
})
