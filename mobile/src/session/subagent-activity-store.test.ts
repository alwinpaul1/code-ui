import { beforeEach, describe, expect, it } from 'vitest'
import type { SubagentTranscriptTarget } from './mobile-subagent-transcript'
import {
  peekSubagentActivityRequest,
  resetSubagentActivityForTests,
  stopWatchingSubagentActivity,
  watchSubagentActivity
} from './subagent-activity-store'
import { PROBE_A_AGENT } from './fixtures/claude-subagent-transcripts-2.1.296'

const target = (agentId: string): SubagentTranscriptTarget => ({
  agent: 'claude',
  agentId,
  sessionId: `agent-${agentId}`,
  transcriptPath: null,
  title: agentId
})

describe("the sheet's subagent read requests", () => {
  beforeEach(() => resetSubagentActivityForTests())

  it("a second, closed sheet does not cancel the open sheet's reads", () => {
    const open = {}
    const closed = {}
    watchSubagentActivity(open, [target(PROBE_A_AGENT)])
    watchSubagentActivity(closed, [])
    stopWatchingSubagentActivity(closed)
    expect(peekSubagentActivityRequest()?.owner).toBe(open)
  })
})
