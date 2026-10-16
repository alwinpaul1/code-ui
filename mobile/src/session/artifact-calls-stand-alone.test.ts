import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { splitTurnIntoSegments } from './mobile-native-chat-turn-segments'
import { artifactSegmentView } from './mobile-native-chat-artifact-segment'
import { PUBLISH_CALL, PUBLISH_RESULT, PUBLISHED_UUID, QUICKSTART_CALL, QUICKSTART_RESULT } from './fixtures/claude-artifact-tool-2.1.301'

// The Claude app 1.261013.20 draws an Artifact call that puts a page up as a
// card of its own (a18.java:56-190, kv30.a), never inside a "Ran 3 tools" group;
// its quickstart, list and read calls are ordinary steps. Before this, Code UI
// folded the publish into the run beside it: "Read a file, used 2 tools".
// The calls are Claude Code 2.1.301's own (fixtures/claude-artifact-tool-2.1.301.ts).

function read(id: string): NativeChatBlock[] {
  return [
    { type: 'tool-call', name: 'Read', input: { file_path: `/repo/${id}.ts` }, callId: `toolu_${id}` },
    { type: 'tool-result', output: 'ok', callId: `toolu_${id}` }
  ]
}

function toolRuns(blocks: NativeChatBlock[]): NativeChatBlock[][] {
  return splitTurnIntoSegments(blocks)
    .filter((segment) => segment.kind === 'tools')
    .map((segment) => segment.blocks)
}

describe('an Artifact publish gets a card of its own', () => {
  it('draws the published page apart from the reads around it', () => {
    const runs = toolRuns([...read('a'), PUBLISH_CALL, PUBLISH_RESULT, ...read('b')])
    expect(runs).toEqual([read('a'), [PUBLISH_CALL, PUBLISH_RESULT], read('b')])
    expect(artifactSegmentView(runs[1]!)).toMatchObject({ kind: 'published', link: { uuid: PUBLISHED_UUID } })
  })

  it('keeps a publish still running on its own row, with no answer yet', () => {
    const runs = toolRuns([...read('a'), PUBLISH_CALL])
    expect(runs).toEqual([read('a'), [PUBLISH_CALL]])
    expect(artifactSegmentView(runs[1]!)).toMatchObject({ kind: 'publishing' })
  })

  it('keeps the quickstart in the run as an ordinary step, with no card', () => {
    const runs = toolRuns([...read('a'), QUICKSTART_CALL, QUICKSTART_RESULT, PUBLISH_CALL, PUBLISH_RESULT])
    expect(runs).toEqual([[...read('a'), QUICKSTART_CALL, QUICKSTART_RESULT], [PUBLISH_CALL, PUBLISH_RESULT]])
    expect(artifactSegmentView(runs[0]!)).toBeNull()
  })

  it('draws a failed publish apart, as the row naming its error', () => {
    const failed: NativeChatBlock = { ...(PUBLISH_RESULT as Extract<NativeChatBlock, { type: 'tool-result' }>), output: 'Publish refused: the file is over 16MB', isError: true }
    const runs = toolRuns([...read('a'), PUBLISH_CALL, failed])
    expect(runs[1]).toEqual([PUBLISH_CALL, failed])
    expect(artifactSegmentView(runs[1]!)).toEqual({ kind: 'failed', message: 'Publish refused: the file is over 16MB' })
  })

  it('keeps a publish made beside a read in one run, each call with its answer', () => {
    const a = read('a')
    const blocks = [a[0]!, PUBLISH_CALL, a[1]!, PUBLISH_RESULT]
    expect(toolRuns(blocks)).toEqual([blocks])
    expect(artifactSegmentView(blocks)).toBeNull()
  })

  it('loses no block and reorders none, however the turn is cut', () => {
    const many = [...read('a'), QUICKSTART_CALL, QUICKSTART_RESULT, { type: 'text', text: 'Publishing it now.' } as NativeChatBlock, PUBLISH_CALL, PUBLISH_RESULT, ...read('b')]
    expect(splitTurnIntoSegments(many).flatMap((segment) => segment.blocks)).toEqual(many)
    // Degenerate: a turn of only the publish, and of nothing.
    expect(toolRuns([PUBLISH_CALL, PUBLISH_RESULT])).toEqual([[PUBLISH_CALL, PUBLISH_RESULT]])
    expect(splitTurnIntoSegments([])).toEqual([])
    expect(artifactSegmentView([])).toBeNull()
  })
})
