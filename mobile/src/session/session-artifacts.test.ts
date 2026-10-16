import { describe, expect, it } from 'vitest'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { ClaudeArtifactListItem } from './claude-artifacts'
import {
  PUBLISHED_LINK,
  PUBLISHED_TITLE,
  PUBLISHED_UUID,
  PUBLISH_CALL,
  PUBLISH_RESULT,
  QUICKSTART_CALL,
  QUICKSTART_RESULT
} from './fixtures/claude-artifact-tool-2.1.301'
import { sessionArtifactRows, sessionArtifacts, sessionArtifactsPillLabel, sessionArtifactTitle } from './session-artifacts'

// The session's artifacts, read from Claude Code 2.1.301's own Artifact calls (the fixture), for
// the session bar's button and the Artifacts sheet (session-artifacts.ts).

let id = 0
function message(...blocks: NativeChatBlock[]): NativeChatMessage {
  id += 1
  return { id: `m${id}`, role: 'assistant', blocks, timestamp: id, source: 'transcript' } as NativeChatMessage
}

const OTHER_UUID = '0f8fad5b-d9cb-469f-a165-70867728950e'
/** A publish of the fixture's page, worded as 2.1.301 words its result. */
function publish(callId: string, input: Record<string, unknown>): NativeChatBlock[] {
  return [
    { type: 'tool-call', name: 'Artifact', callId, input },
    { type: 'tool-result', callId, output: `Published /tmp/page.html at ${PUBLISHED_LINK} (Version 1, version id 1-a) Icon: "chart".` }
  ]
}

describe("a Claude session's artifacts", () => {
  it('counts the page a publish put up, with its link and the file name as its title', () => {
    const artifacts = sessionArtifacts([message(PUBLISH_CALL), message(PUBLISH_RESULT)])
    expect(artifacts).toEqual([{ uuid: PUBLISHED_UUID, url: PUBLISHED_LINK, title: 'code-ui-artifact-check.html' }])
  })

  it('does not count a quickstart, though its result names artifact links', () => {
    expect(sessionArtifacts([message(QUICKSTART_CALL, QUICKSTART_RESULT)])).toEqual([])
  })

  it('counts a republish of the same page once, with the newer title', () => {
    const artifacts = sessionArtifacts([
      message(...publish('a', { file_path: '/tmp/page.html' })),
      message(QUICKSTART_CALL, QUICKSTART_RESULT),
      message(...publish('b', { file_path: '/tmp/page.html', title: 'Renamed page' }))
    ])
    expect(artifacts).toEqual([{ uuid: PUBLISHED_UUID, url: PUBLISHED_LINK, title: 'Renamed page' }])
  })

  it('keeps several pages in the order they were made', () => {
    const second = `https://claude.ai/artifact/${'3'.repeat(5)}`
    const artifacts = sessionArtifacts([
      message(...publish('a', { file_path: '/tmp/one.html' })),
      message(
        { type: 'tool-call', name: 'Artifact', callId: 'b', input: { file_path: '/tmp/two.html' } },
        { type: 'tool-result', callId: 'b', output: `Published /tmp/two.html at ${second} (Version 1).` }
      )
    ])
    expect(artifacts.map((artifact) => artifact.title)).toEqual(['one.html', 'two.html'])
  })

  it('does not count a publish that failed or is still running', () => {
    expect(
      sessionArtifacts([
        message({ type: 'tool-call', name: 'Artifact', callId: 'a', input: { file_path: '/tmp/a.html' } }),
        message(
          { type: 'tool-call', name: 'Artifact', callId: 'b', input: { file_path: '/tmp/b.html' } },
          { type: 'tool-result', callId: 'b', output: 'Error: refused', isError: true }
        )
      ])
    ).toEqual([])
  })

  it('pairs a call and result that name no id by position', () => {
    const [call, result] = publish('x', { file_path: '/tmp/page.html' })
    const bare = (block: NativeChatBlock) => ({ ...block, callId: undefined }) as NativeChatBlock
    expect(sessionArtifacts([message(bare(call!)), message(bare(result!))])).toHaveLength(1)
  })

  it('has none in an empty chat', () => {
    expect(sessionArtifacts([])).toEqual([])
  })
})

describe('what the button and the sheet call them', () => {
  const listed = (over: Partial<ClaudeArtifactListItem>): ClaudeArtifactListItem => ({
    uuid: PUBLISHED_UUID,
    title: PUBLISHED_TITLE,
    rel: 'mine',
    updatedAt: 1_000,
    url: PUBLISHED_LINK,
    createdAt: null,
    audience: null,
    typeTitle: null,
    typeSlug: null,
    thumbUrl: null,
    starred: false,
    ownerEmail: null,
    ...over
  })

  it("titles a session page by the account list's title, else the call's, else Artifact", () => {
    const artifact = { uuid: PUBLISHED_UUID, url: PUBLISHED_LINK, title: 'page.html' }
    expect(sessionArtifactTitle(artifact, [listed({})])).toBe(PUBLISHED_TITLE)
    expect(sessionArtifactTitle(artifact, [])).toBe('page.html')
    expect(sessionArtifactTitle({ ...artifact, title: null }, [])).toBe('Artifact')
  })

  it('reads one artifact or two artifacts', () => {
    expect(sessionArtifactsPillLabel(1)).toBe('1 artifact')
    expect(sessionArtifactsPillLabel(2)).toBe('2 artifacts')
  })

  it("lists the session newest first, titled from the account's list, and none of the account's other pages", () => {
    const rows = sessionArtifactRows(
      [
        { uuid: PUBLISHED_UUID, url: PUBLISHED_LINK, title: 'first.html' },
        { uuid: OTHER_UUID, url: 'https://claude.ai/artifact/x', title: 'second.html' }
      ],
      [
        listed({}),
        listed({ uuid: 'a0000000-0000-4000-8000-000000000001', title: 'Older mine', url: 'u1' }),
        listed({ uuid: 'a0000000-0000-4000-8000-000000000002', title: 'From a friend', rel: 'shared', url: 'u2' })
      ]
    )
    expect(rows.map((row) => row.title)).toEqual(['second.html', PUBLISHED_TITLE])
    expect(rows.every((row) => row.subtitle === 'Artifact · claude.ai')).toBe(true)
  })

  it('has no rows for an empty session, and one for one', () => {
    expect(sessionArtifactRows([], [])).toEqual([])
    expect(sessionArtifactRows([{ uuid: OTHER_UUID, url: 'u', title: null }], [])).toEqual([
      { uuid: OTHER_UUID, url: 'u', title: 'Artifact', subtitle: 'Artifact · claude.ai' }
    ])
  })
})
