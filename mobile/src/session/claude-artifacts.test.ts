import { describe, expect, it } from 'vitest'
import {
  artifactCallTitle,
  artifactCallView,
  artifactIdToUuid,
  artifactUuidToId,
  claudeArtifactUrl,
  fetchClaudeArtifactList,
  findClaudeArtifactLinks,
  parseClaudeArtifactLink,
  parseClaudeArtifactList
} from './claude-artifacts'
import type { CcrFetch } from './ccr-session-api'
import {
  PUBLISHED_FILE_PATH,
  PUBLISHED_LINK,
  PUBLISHED_UUID,
  PUBLISH_CALL,
  PUBLISH_RESULT,
  QUICKSTART_CALL,
  QUICKSTART_RESULT
} from './fixtures/claude-artifact-tool-2.1.301'
import type { NativeChatToolCallBlock, NativeChatToolResultBlock } from '../../../src/shared/native-chat-types'

const call = (block: unknown) => block as NativeChatToolCallBlock
const result = (block: unknown) => block as NativeChatToolResultBlock

describe('artifact links', () => {
  it('reads the id Claude Code 2.1.301 publishes as the uuid the account list names', () => {
    expect(artifactIdToUuid('8JHvPGXwg2SLbchagvbYU6')).toBe(PUBLISHED_UUID)
    expect(artifactUuidToId(PUBLISHED_UUID)).toBe('8JHvPGXwg2SLbchagvbYU6')
    expect(claudeArtifactUrl(PUBLISHED_UUID)).toBe(PUBLISHED_LINK)
  })

  it('round-trips the smallest and largest uuids', () => {
    const zero = '00000000-0000-0000-0000-000000000000'
    const max = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
    expect(artifactIdToUuid(artifactUuidToId(zero)!)).toBe(zero)
    expect(artifactIdToUuid(artifactUuidToId(max)!)).toBe(max)
  })

  it('opens every link shape the Claude app reads, on claude.ai and preview', () => {
    expect(parseClaudeArtifactLink(PUBLISHED_LINK)).toEqual({ uuid: PUBLISHED_UUID, url: PUBLISHED_LINK })
    expect(parseClaudeArtifactLink(`https://claude.ai/code/artifact/${PUBLISHED_UUID}`)?.uuid).toBe(PUBLISHED_UUID)
    expect(parseClaudeArtifactLink('https://claude.ai/code/artifact/my-page-8JHvPGXwg2SLbchagvbYU6')?.uuid).toBe(PUBLISHED_UUID)
    expect(parseClaudeArtifactLink('https://claude.ai/code/frame/8JHvPGXwg2SLbchagvbYU6')?.uuid).toBe(PUBLISHED_UUID)
    expect(parseClaudeArtifactLink(`https://claude.ai/code/artifact/my-page-${PUBLISHED_UUID}`)?.uuid).toBe(PUBLISHED_UUID)
    expect(parseClaudeArtifactLink('https://preview.claude.ai/artifact/8JHvPGXwg2SLbchagvbYU6')?.uuid).toBe(PUBLISHED_UUID)
  })

  it('keeps a share key on the link and drops a fragment', () => {
    expect(parseClaudeArtifactLink(`${PUBLISHED_LINK}?sk=abc#comments`)?.url).toBe(`${PUBLISHED_LINK}?sk=abc`)
  })

  it('leaves every other link alone', () => {
    for (const other of [
      'https://claude.ai/chat/8JHvPGXwg2SLbchagvbYU6',
      'http://claude.ai/artifact/8JHvPGXwg2SLbchagvbYU6',
      'https://evil.example/artifact/8JHvPGXwg2SLbchagvbYU6',
      'https://claude.ai.evil.example/artifact/8JHvPGXwg2SLbchagvbYU6',
      'https://claude.ai/artifact/',
      'https://claude.ai/artifact/0OIl',
      'https://claude.ai/artifact/8JHvPGXwg2SLbchagvbYU6/extra',
      'not a url',
      ''
    ]) {
      expect(parseClaudeArtifactLink(other), other).toBeNull()
    }
  })

  it('finds each artifact in prose once, without the sentence stop after it', () => {
    const text = `Here it is: ${PUBLISHED_LINK}. Same page again (${PUBLISHED_LINK}) and https://example.com.`
    expect(findClaudeArtifactLinks(text)).toEqual([{ uuid: PUBLISHED_UUID, url: PUBLISHED_LINK }])
    expect(findClaudeArtifactLinks('')).toEqual([])
  })
})

describe('an Artifact call as the Claude app draws it', () => {
  it('shows the publish as a published card once its result names the page', () => {
    expect(artifactCallView(call(PUBLISH_CALL), result(PUBLISH_RESULT))).toEqual({
      kind: 'published',
      title: 'code-ui-artifact-check.html',
      link: { uuid: PUBLISHED_UUID, url: PUBLISHED_LINK }
    })
  })

  it('shows a running publish as Publishing, titled by its file until the page answers', () => {
    expect(artifactCallView(call(PUBLISH_CALL), null)).toEqual({ kind: 'publishing', title: 'code-ui-artifact-check.html' })
  })

  it('keeps a quickstart a plain row even though its result names artifact links', () => {
    expect(artifactCallView(call(QUICKSTART_CALL), result(QUICKSTART_RESULT))).toEqual({ kind: 'row' })
    expect(artifactCallView(call(QUICKSTART_CALL), null)).toEqual({ kind: 'row' })
  })

  it('shows an open as Opening, then the page it opened', () => {
    const open = call({ type: 'tool-call', name: 'Artifact', input: { action: 'open', url: PUBLISHED_LINK } })
    expect(artifactCallView(open, null)).toEqual({ kind: 'opening', title: null })
    expect(artifactCallView(open, result({ type: 'tool-result', output: 'Opened.' }))).toMatchObject({ kind: 'published', link: { uuid: PUBLISHED_UUID } })
  })

  it('shows a refused publish as a failure with its first line', () => {
    const refused = result({ type: 'tool-result', output: 'Publishing was refused: the page imitates a bank.\nMore detail', isError: true })
    expect(artifactCallView(call(PUBLISH_CALL), refused)).toEqual({ kind: 'failed', message: 'Publishing was refused: the page imitates a bank.' })
    expect(artifactCallView(call({ ...PUBLISH_CALL, state: 'failed' }), null)).toEqual({ kind: 'failed', message: null })
  })

  // Review 2026-10-16: these drew as a "Publishing…" card, then fell back into the run beside them
  // once answered, so the turn's layout jumped and the runs after it remounted.
  it('keeps an asset upload and a start from a type plain rows from the start', () => {
    const asset = call({ type: 'tool-call', name: 'Artifact', input: { url: PUBLISHED_LINK, file_path: '/tmp/logo.png', asset: true } })
    expect(artifactCallView(asset, null)).toEqual({ kind: 'row' })
    expect(artifactCallView(asset, result({ type: 'tool-result', output: `Uploaded /tmp/logo.png to ${PUBLISHED_LINK}` }))).toEqual({ kind: 'row' })
    const fromType = call({ type: 'tool-call', name: 'Artifact', input: { type_url: 'https://claude.ai/artifact/GZLZthZ2sQjn7T16skfdeF', title: 'Dash' } })
    expect(artifactCallView(fromType, null)).toEqual({ kind: 'row' })
  })

  it('falls back to a plain row when a publish ends without a link', () => {
    expect(artifactCallView(call(PUBLISH_CALL), result({ type: 'tool-result', output: '' }))).toEqual({ kind: 'row' })
    expect(artifactCallView(call({ ...PUBLISH_CALL, state: 'completed' }), null)).toEqual({ kind: 'row' })
  })

  it('titles a call by its title, then its label, then its file name, then nothing', () => {
    expect(artifactCallTitle({ title: ' Plan ', file_path: PUBLISHED_FILE_PATH })).toBe('Plan')
    expect(artifactCallTitle({ label: 'Board' })).toBe('Board')
    expect(artifactCallTitle({ file_path: 'C:\\pages\\board.html' })).toBe('board.html')
    expect(artifactCallTitle({ file_path: '/' })).toBeNull()
    expect(artifactCallTitle(null)).toBeNull()
  })
})

describe("the account's artifact list", () => {
  const body = {
    frames: [
      { slug: 'dce20df4-428d-4361-8a7f-3119949934f9', title: 'BLADE Fig. 1 Options', rel: 'mine', updatedAt: '2026-09-27T17:59:45Z' },
      { slug: PUBLISHED_UUID, title: 'Code UI Artifact Check', rel: 'mine', updatedAt: '2026-10-16T12:09:22Z' },
      { slug: '9dbb2946-6231-444c-887e-acdb5e175903', title: '  ', rel: 'shared' },
      { slug: '11111111-1111-1111-1111-111111111111', title: 'Gone', rel: 'mine', softDeleted: true },
      { slug: '22222222-2222-2222-2222-222222222222', title: 'Odd', rel: 'team' },
      { slug: 'not-a-uuid', title: 'Broken', rel: 'mine' },
      'junk'
    ],
    thumbsEnabled: true,
    starsEnabled: true
  }

  it('lists live rows newest first, untitled ones as Untitled, and skips what it cannot read', () => {
    const items = parseClaudeArtifactList(body)
    expect(items.map((item) => [item.title, item.rel])).toEqual([
      ['Code UI Artifact Check', 'mine'],
      ['BLADE Fig. 1 Options', 'mine'],
      ['Untitled', 'shared']
    ])
    expect(items[0]!.url).toBe(PUBLISHED_LINK)
    expect(items[2]!.updatedAt).toBeNull()
  })

  it('reads what the gallery draws from a P18 row, and leaves out what a row does not carry', () => {
    // Two rows as the live list answered them on 2026-10-16 (probe P18), the token in the
    // thumbnail URL replaced.
    const [own, shared] = parseClaudeArtifactList({
      frames: [
        {
          slug: PUBLISHED_UUID,
          title: 'Code UI Artifact Check',
          rel: 'mine',
          updatedAt: '2026-10-16T12:09:22Z',
          created_at: '2026-10-16T12:00:00Z',
          audience: 'public',
          type_title: 'Design',
          type_slug: 'design',
          thumbImgURL: `https://${PUBLISHED_UUID}.frame.claudeusercontent.com/_f/3/_thumb.img?__frame_t=TOKEN`,
          starred: true,
          icon: 'Checklist',
          icon_key: 'checklist',
          tint: null
        },
        { slug: '9dbb2946-6231-444c-887e-acdb5e175903', title: 'Team roadmap', rel: 'shared', created_at: '2026-10-01T09:00:00Z', owner_email: ' ada@example.com ', type_title: null }
      ],
      starsEnabled: true,
      thumbsEnabled: true
    })
    expect(own).toMatchObject({
      createdAt: Date.parse('2026-10-16T12:00:00Z'),
      audience: 'public',
      typeTitle: 'Design',
      typeSlug: 'design',
      thumbUrl: `https://${PUBLISHED_UUID}.frame.claudeusercontent.com/_f/3/_thumb.img?__frame_t=TOKEN`,
      starred: true,
      ownerEmail: null
    })
    expect(shared).toMatchObject({
      updatedAt: null,
      createdAt: Date.parse('2026-10-01T09:00:00Z'),
      audience: null,
      typeTitle: null,
      typeSlug: null,
      thumbUrl: null,
      starred: false,
      ownerEmail: 'ada@example.com'
    })
  })

  it('places a row with no update time by when it was made', () => {
    const items = parseClaudeArtifactList({
      frames: [
        { slug: '11111111-1111-4111-8111-111111111111', title: 'Older edit', rel: 'mine', updatedAt: '2026-10-14T00:00:00Z' },
        { slug: '22222222-2222-4222-8222-222222222222', title: 'Shared yesterday', rel: 'shared', created_at: '2026-10-15T00:00:00Z' },
        { slug: '33333333-3333-4333-8333-333333333333', title: 'No dates', rel: 'shared' }
      ]
    })
    expect(items.map((item) => item.title)).toEqual(['Shared yesterday', 'Older edit', 'No dates'])
  })

  it('reads a starred that is not true, and a blank type, as none', () => {
    const [item] = parseClaudeArtifactList({ frames: [{ slug: PUBLISHED_UUID, title: 'x', rel: 'mine', starred: 'yes', type_title: '  ', created_at: 'garbage' }] })
    expect(item).toMatchObject({ starred: false, typeTitle: null, createdAt: null })
  })

  it('reads no rows from a body that is not a list', () => {
    expect(parseClaudeArtifactList(null)).toEqual([])
    expect(parseClaudeArtifactList({ frames: {} })).toEqual([])
    expect(parseClaudeArtifactList({ frames: [] })).toEqual([])
  })

  it('asks with the headers Claude Code sends and the account token, and reads the rows', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = []
    const fetchImpl: CcrFetch = async (url, init) => {
      seen.push({ url, headers: init.headers })
      return { ok: true, status: 200, json: async () => body }
    }
    const items = await fetchClaudeArtifactList({ fetch: fetchImpl, auth: async () => ({ token: 'tok', organizationUuid: 'org' }) }, 'acct')
    expect(items).toHaveLength(3)
    expect(seen[0]!.url).toBe('https://api.anthropic.com/api/frame/frames?limit=200')
    expect(seen[0]!.headers).toMatchObject({ Authorization: 'Bearer tok', 'X-Frame-CP': 'go', 'X-Frame-Surface': 'code', 'X-Frame-Platform': 'android' })
  })

  it('reads the sign-in again once after a 401, and says signed out when there is none', async () => {
    const tokens: string[] = []
    const fetchImpl: CcrFetch = async (_url, init) => {
      tokens.push(init.headers.Authorization!)
      return tokens.length === 1 ? { ok: false, status: 401, json: async () => ({}) } : { ok: true, status: 200, json: async () => body }
    }
    let reads = 0
    const auth = async () => ({ token: `t${++reads}`, organizationUuid: 'org' })
    await expect(fetchClaudeArtifactList({ fetch: fetchImpl, auth }, 'acct')).resolves.toHaveLength(3)
    expect(tokens).toEqual(['Bearer t1', 'Bearer t2'])
    await expect(fetchClaudeArtifactList({ fetch: fetchImpl, auth: async () => null }, 'acct')).rejects.toThrow()
  })

  it('names the stage and status when the list is refused', async () => {
    const fetchImpl: CcrFetch = async () => ({ ok: false, status: 500, json: async () => ({}) })
    await expect(fetchClaudeArtifactList({ fetch: fetchImpl, auth: async () => ({ token: 't', organizationUuid: 'o' }) }, 'acct')).rejects.toThrow('artifacts: http (HTTP 500)')
  })
})
