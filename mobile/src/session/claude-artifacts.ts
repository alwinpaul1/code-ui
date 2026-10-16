import { CCR_ANTHROPIC_VERSION, CCR_API_BASE_URL, getCcrJson, type CcrFetch } from './ccr-session-api'
import { withAccountAuth } from './ccr-send'
import type { CcrLinkDeps } from './ccr-session-link-types'
import { record, stringOrNull } from './ccr-session-row'
import type { NativeChatToolCallBlock, NativeChatToolResultBlock } from '../../../src/shared/native-chat-types'

// ─── Claude Code artifacts: links, tool calls, and the account's list ────────
//
// Claude Code's `Artifact` tool publishes an HTML page to claude.ai. The
// Claude Android app 1.261013.20 draws each call as a card (a18.java:56-190,
// kv30.a), turns artifact links in Claude's words into chips (ht1.java), and
// opens them in its own viewer. This module is the part of that with no
// drawing in it.
//
// Links. The app reads `/artifact/<id>`, `/code/artifact/<slug->id` and the
// older `/code/frame/<id>` on claude.ai or preview.claude.ai (cnn.java:11,
// ct1.java:27, a22.java:87). Claude Code 2.1.301's publish answers with
// `https://claude.ai/artifact/<id>`, where <id> is the base58 (bitcoin
// alphabet) of the artifact's uuid: `8JHvPGXwg2SLbchagvbYU6` is
// `3b1a0ad3-2ac6-4209-b219-d64d46bfa3bf` (checked 2026-10-16). The account's
// list names artifacts by that uuid (`slug`), so a link and a list row are
// matched through it.
//
// The list. Claude Code 2.1.301 lists the account's artifacts itself with its
// claude.ai OAuth token: `GET {BASE_API_URL}/api/frame/frames?limit=200`
// (host "frame", auth "claude-ai-oauth": Bearer + anthropic-beta, and its
// `X-Frame-*` headers). Probe P17 (2026-10-16) read the same list with the
// phone's kind of token: 200, `{frames, thumbsEnabled, starsEnabled}`, rows
// `{slug, title, rel: mine|shared, updatedAt, softDeleted?, icon, tint,
// thumbImgURL, …}`. Nothing in it names the session that made an artifact.
// P18 (2026-10-16) added `created_at`, `audience` (`owner`, `public`),
// `type_title` (null or "Design"), `type_slug`, `starred` (on no row, with
// `starsEnabled: true`) and `owner_email`; all but slug, title and rel are
// absent on some rows, so every one of them is optional here.

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ARTIFACT_HOSTS = new Set(['claude.ai', 'preview.claude.ai'])
/** Where an artifact link can sit in prose: up to the first space, quote or bracket. */
const LINK_IN_TEXT = /https:\/\/(?:preview\.)?claude\.ai\/(?:code\/)?(?:artifact|frame)\/[^\s"'`<>()[\]]+/g

/** The uuid an artifact's link id stands for, or null when it is not one. */
export function artifactIdToUuid(id: string): string | null {
  if (id.length === 0 || id.length > 23) {
    return null
  }
  let value = 0n
  for (const char of id) {
    const digit = BASE58.indexOf(char)
    if (digit === -1) {
      return null
    }
    value = value * 58n + BigInt(digit)
  }
  if (value >= 1n << 128n) {
    return null
  }
  const hex = value.toString(16).padStart(32, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** An artifact uuid as its link writes it. */
export function artifactUuidToId(uuid: string): string | null {
  if (!UUID.test(uuid)) {
    return null
  }
  let value = BigInt(`0x${uuid.replace(/-/g, '')}`)
  let id = ''
  while (value > 0n) {
    id = BASE58[Number(value % 58n)]! + id
    value /= 58n
  }
  return id || BASE58[0]!
}

/** The link the phone opens for an artifact the account's list names. */
export function claudeArtifactUrl(uuid: string): string | null {
  const id = artifactUuidToId(uuid)
  return id === null ? null : `https://claude.ai/artifact/${id}`
}

export type ClaudeArtifactLink = {
  /** The artifact's uuid, lower case: the key a list row and a link share. */
  uuid: string
  /** The link as written, minus any `#fragment`; a share key (`?sk=`) stays on it. */
  url: string
}

/** A claude.ai artifact link, or null for any other URL. */
export function parseClaudeArtifactLink(raw: string): ClaudeArtifactLink | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !ARTIFACT_HOSTS.has(url.hostname.toLowerCase())) {
    return null
  }
  const parts = url.pathname.split('/').filter((part) => part.length > 0)
  const last =
    parts.length === 2 && parts[0] === 'artifact'
      ? parts[1]!
      : parts.length === 3 && parts[0] === 'code' && (parts[1] === 'artifact' || parts[1] === 'frame')
        ? parts[2]!
        : null
  if (last === null) {
    return null
  }
  // `/code/artifact/<slug->id` (ct1.java:27): the id after the slug is a uuid or its base58.
  const tail = last.slice(-36)
  const uuid = UUID.test(tail) ? tail.toLowerCase() : artifactIdToUuid(last.slice(last.lastIndexOf('-') + 1))
  if (uuid === null) {
    return null
  }
  url.hash = ''
  return { uuid, url: url.toString() }
}

/** Every artifact link in a piece of prose, in order, each artifact once. */
export function findClaudeArtifactLinks(text: string): ClaudeArtifactLink[] {
  const seen = new Set<string>()
  const links: ClaudeArtifactLink[] = []
  for (const match of text.matchAll(LINK_IN_TEXT)) {
    // A sentence's closing stop or comma is not part of the link.
    const link = parseClaudeArtifactLink(match[0].replace(/[.,;:!?]+$/, ''))
    if (link && !seen.has(link.uuid)) {
      seen.add(link.uuid)
      links.push(link)
    }
  }
  return links
}

// ─── One Artifact tool call ──────────────────────────────────────────────────

/** What the Claude app's card shows for one Artifact call (a18.java:56-190), or `row` for a call
 *  it draws as a plain tool row: an action that publishes nothing (list, read, quickstart…), or a
 *  call that ended without a link. */
export type ArtifactCallView =
  | { kind: 'publishing'; title: string | null }
  | { kind: 'opening'; title: string | null }
  | { kind: 'published'; title: string | null; link: ClaudeArtifactLink }
  | { kind: 'failed'; message: string | null }
  | { kind: 'row' }

/** The `action` words that put a page up: absent (a `file_path` or files publish), or "publish". */
function actionOf(input: Record<string, unknown> | null): 'publish' | 'open' | 'other' {
  const action = stringOrNull(input?.action)?.trim().toLowerCase() ?? ''
  if (action === 'open') {
    return 'open'
  }
  // An asset upload (`asset: true`) answers "Uploaded …", and a start from an Artifact type
  // (`type_url`, no files) answers with the type's instructions: neither is a page going up, and
  // drawing either as a card that then falls back into the run made the turn jump (review
  // 2026-10-16).
  if (input?.asset === true || (typeof input?.type_url === 'string' && typeof input.file_path !== 'string' && input.files === undefined)) {
    return 'other'
  }
  if (action === 'publish' || (action === '' && input !== null && (typeof input.file_path === 'string' || input.files !== undefined))) {
    return 'publish'
  }
  return 'other'
}

/** The title a call states for itself before anything is published: its `title`, else the
 *  file's name (eq30.java:5076 `h`, after the published title it cannot know yet). */
export function artifactCallTitle(input: unknown): string | null {
  const fields = record(input)
  const title = stringOrNull(fields?.title)?.trim() || stringOrNull(fields?.label)?.trim()
  if (title) {
    return title
  }
  const path = stringOrNull(fields?.file_path)?.trim()
  const name = path?.split(/[/\\]/).pop()?.trim()
  return name ? name : null
}

/** The published link a publish result names: on its FIRST line, after "at". A quickstart or a
 *  list also names artifact links (type URLs, the account's pages), and none of those is this
 *  call's page, so only the first line of a publish is read. */
function publishedLinkOf(output: string): ClaudeArtifactLink | null {
  const firstLine = output.split('\n', 1)[0] ?? ''
  if (!/^(Published|Updated|Republished)\b/.test(firstLine)) {
    return null
  }
  return findClaudeArtifactLinks(firstLine)[0] ?? null
}

/** The card for one Artifact call and its result (absent while it runs). */
export function artifactCallView(call: NativeChatToolCallBlock, result: NativeChatToolResultBlock | null): ArtifactCallView {
  const input = record(call.input)
  const action = actionOf(input)
  if (action === 'other') {
    return { kind: 'row' }
  }
  if (call.state === 'failed' || result?.isError === true) {
    const firstLine = result?.output.split('\n', 1)[0]?.trim()
    return { kind: 'failed', message: firstLine ? firstLine : null }
  }
  const title = artifactCallTitle(call.input)
  if (!result) {
    if (call.state === 'completed') {
      return { kind: 'row' }
    }
    return action === 'open' ? { kind: 'opening', title } : { kind: 'publishing', title }
  }
  const link = action === 'open' ? parseClaudeArtifactLink(stringOrNull(input?.url) ?? '') : publishedLinkOf(result.output)
  return link ? { kind: 'published', title, link } : { kind: 'row' }
}

// ─── The account's artifact list ─────────────────────────────────────────────

export type ClaudeArtifactListItem = {
  uuid: string
  title: string
  /** `mine` (the account made it) or `shared` (someone shared it with the account). */
  rel: 'mine' | 'shared'
  /** Epoch ms, or null when the row carries none. */
  updatedAt: number | null
  url: string
  /** Epoch ms of `created_at`, or null. */
  createdAt: number | null
  /** Who can open it, as the server spells it (`owner`, `public` seen 2026-10-16), or null. The
   *  gallery maps the words it knows (claude-artifact-gallery.ts). */
  audience: string | null
  /** The Artifact type's name (`type_title`, "Design" seen), or null for a page with no type. */
  typeTitle: string | null
  typeSlug: string | null
  /** `thumbImgURL`: a signed claudeusercontent.com URL whose query carries a token. Never log it. */
  thumbUrl: string | null
  /** Pinned (`starred`). Absent on every row P18 read, so false unless the row says true. */
  starred: boolean
  /** Who shared it (`owner_email`), for a shared row; null when the row does not say. */
  ownerEmail: string | null
}

/** Claude Code 2.1.301's own `X-Frame-*` headers (`su()`), naming this client as the Android app
 *  does (`X-Frame-Platform: android`, q32.java). P17 read the list with and without the beta. */
export function claudeArtifactListHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Anthropic-Version': CCR_ANTHROPIC_VERSION,
    'Anthropic-Beta': 'oauth-2025-04-20',
    Accept: 'application/json',
    'X-Frame-CP': 'go',
    'X-Frame-Surface': 'code',
    'X-Frame-Platform': 'android'
  }
}

export const CLAUDE_ARTIFACT_LIST_URL = `${CCR_API_BASE_URL}/api/frame/frames?limit=200`

function timeOf(value: unknown): number | null {
  const ms = Date.parse(stringOrNull(value) ?? '')
  return Number.isFinite(ms) ? ms : null
}

/** A field's trimmed text, or null when it is absent, not a string, or blank. */
function textOf(value: unknown): string | null {
  return stringOrNull(value)?.trim() || null
}

/** The rows a list reply holds, newest first (edited, else created), without deleted ones or a rel this client does
 *  not know. A row that does not parse is left out; the rest still show. */
export function parseClaudeArtifactList(body: unknown): ClaudeArtifactListItem[] {
  const frames = record(body)?.frames
  if (!Array.isArray(frames)) {
    return []
  }
  const items: ClaudeArtifactListItem[] = []
  for (const frame of frames) {
    const row = record(frame)
    const uuid = stringOrNull(row?.slug)?.toLowerCase() ?? null
    const rel = row?.rel
    if (!row || uuid === null || !UUID.test(uuid) || row.softDeleted === true || (rel !== 'mine' && rel !== 'shared')) {
      continue
    }
    const url = claudeArtifactUrl(uuid)
    if (url === null) {
      continue
    }
    items.push({
      uuid,
      title: stringOrNull(row.title)?.trim() || 'Untitled',
      rel,
      updatedAt: timeOf(row.updatedAt),
      url,
      createdAt: timeOf(row.created_at),
      audience: textOf(row.audience),
      typeTitle: textOf(row.type_title),
      typeSlug: textOf(row.type_slug),
      thumbUrl: textOf(row.thumbImgURL),
      starred: row.starred === true,
      ownerEmail: textOf(row.owner_email)
    })
  }
  // A row with no `updatedAt` (P18: some shared rows) is placed by its `created_at`.
  const at = (item: ClaudeArtifactListItem) => item.updatedAt ?? item.createdAt ?? 0
  return items.sort((a, b) => at(b) - at(a))
}

/** The account's artifacts, read with its own sign-in (once more after a 401). */
export async function fetchClaudeArtifactList(deps: Pick<CcrLinkDeps, 'auth'> & { fetch: CcrFetch }, accountId: string): Promise<ClaudeArtifactListItem[]> {
  return withAccountAuth(deps, accountId, async (auth) =>
    parseClaudeArtifactList(await getCcrJson(deps.fetch, 'artifacts', CLAUDE_ARTIFACT_LIST_URL, claudeArtifactListHeaders(auth.token)))
  )
}
