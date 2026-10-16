import type { ClaudeArtifactListItem } from './claude-artifacts'
import type { ClaudeCdsGlyphName } from './ClaudeCdsGlyph'
import { formatTimeAgo } from '../worktree/agent-row-display'

// ─── The account's Artifacts gallery, without the drawing ────────────────────
//
// The Claude Android app 1.261013.20 lists every artifact of the account on its own screen, the
// "Artifacts" tab (vew.java:16; xo30.java, uo30.java, vf9.java, the row in jbh.java:174-420). This
// module is what that screen decides: which rows a list and a type show, what each row's lines say,
// and what the screen says when nothing is left to show. ClaudeArtifactGallery.tsx draws it.

export type ArtifactListFilter = 'all' | 'pinned' | 'yours' | 'shared'

/** The list dropdown's choices, in the app's order (strings.xml artifact_gallery_tab_*). */
export const ARTIFACT_LIST_FILTERS: readonly { value: ArtifactListFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pinned', label: 'Pinned' },
  { value: 'yours', label: 'Yours' },
  { value: 'shared', label: 'Shared with you' }
]

/** The type dropdown's choice: every type, one named type, or the rows that have none ("Other"). */
export type ArtifactTypeFilter = { kind: 'all' } | { kind: 'type'; title: string } | { kind: 'other' }

export const ALL_TYPES_LABEL = 'All types'
export const OTHER_TYPE_LABEL = 'Other'
export const SEARCH_ARTIFACTS_HINT = 'Search artifacts'
export const SEARCH_DEBOUNCE_MS = 300
export const ARTIFACTS_EMPTY_TEXT = 'Artifacts you’ve had with Claude will show up here.'
export const NO_ARTIFACTS_MATCH_TEXT = 'No artifacts match'

export type ArtifactGalleryFilters = { list: ArtifactListFilter; type: ArtifactTypeFilter; query: string }

export const DEFAULT_ARTIFACT_GALLERY_FILTERS: ArtifactGalleryFilters = { list: 'all', type: { kind: 'all' }, query: '' }

/**
 * The type dropdown's choices: "All types", each type a row names (first seen first: the list is
 * newest first, so the type last worked in leads), then "Other" when some row has no type. Null —
 * no dropdown — when no row names a type.
 */
export function artifactTypeOptions(items: readonly ClaudeArtifactListItem[]): { filter: ArtifactTypeFilter; label: string }[] | null {
  const titles: string[] = []
  let untyped = false
  for (const item of items) {
    if (item.typeTitle === null) {
      untyped = true
    } else if (!titles.includes(item.typeTitle)) {
      titles.push(item.typeTitle)
    }
  }
  if (titles.length === 0) {
    return null
  }
  return [
    { filter: { kind: 'all' }, label: ALL_TYPES_LABEL },
    ...titles.map((title) => ({ filter: { kind: 'type', title } as const, label: title })),
    ...(untyped ? [{ filter: { kind: 'other' } as const, label: OTHER_TYPE_LABEL }] : [])
  ]
}

/** Whether two type choices are the same choice: by kind, and by title for a named type, never by
 *  label, since a type may be titled "Other" or "All types" (review 2026-10-16). */
export function sameArtifactTypeFilter(a: ArtifactTypeFilter, b: ArtifactTypeFilter): boolean {
  return a.kind === b.kind && (a.kind !== 'type' || (b.kind === 'type' && a.title === b.title))
}

export function artifactTypeLabel(filter: ArtifactTypeFilter): string {
  return filter.kind === 'all' ? ALL_TYPES_LABEL : filter.kind === 'other' ? OTHER_TYPE_LABEL : filter.title
}

function inList(item: ClaudeArtifactListItem, list: ArtifactListFilter): boolean {
  switch (list) {
    case 'all':
      return true
    case 'pinned':
      return item.starred
    case 'yours':
      return item.rel === 'mine'
    case 'shared':
      return item.rel === 'shared'
    default: {
      const unhandled: never = list
      return unhandled
    }
  }
}

function ofType(item: ClaudeArtifactListItem, type: ArtifactTypeFilter): boolean {
  return type.kind === 'all' || (type.kind === 'other' ? item.typeTitle === null : item.typeTitle === type.title)
}

/** The rows the gallery shows: in the list and the type chosen, whose title holds the search. */
export function filterArtifactGallery(items: readonly ClaudeArtifactListItem[], filters: ArtifactGalleryFilters): ClaudeArtifactListItem[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return items.filter(
    (item) => inList(item, filters.list) && ofType(item, filters.type) && (query === '' || item.title.toLocaleLowerCase().includes(query))
  )
}

export function isDefaultArtifactGalleryFilters(filters: ArtifactGalleryFilters): boolean {
  return filters.list === 'all' && filters.type.kind === 'all' && filters.query.trim() === ''
}

/** What an empty gallery says: the app's welcome line with nothing chosen, else "No artifacts match". */
export function artifactGalleryEmptyText(filters: ArtifactGalleryFilters): string {
  return isDefaultArtifactGalleryFilters(filters) ? ARTIFACTS_EMPTY_TEXT : NO_ARTIFACTS_MATCH_TEXT
}

// ─── One row's lines (jbh.java:174-420, 1127-1240, 1520-1575) ────────────────

export type ArtifactAudienceView = { label: string; glyph: ClaudeCdsGlyphName }

/**
 * Who can open one of the account's own artifacts. The app's ArtifactAudience is `owner`, `users`,
 * `org` or `public` (h71.java:35), drawn lock / users / organization / globe (jbh.java:1180-1195).
 * The list Code UI reads (`/api/frame/frames`) was seen with `owner` and `public` only (P18,
 * 2026-10-16); `org`/`organization` and the fall-through to "People with access" for any other
 * word (`users`, `shared`, `people` …) are unverified guesses. No audience: no line.
 */
export function artifactAudienceView(audience: string | null): ArtifactAudienceView | null {
  const word = audience?.trim().toLowerCase() ?? ''
  if (word === '' || word === 'unknown') {
    return null
  }
  if (word === 'owner') {
    return { label: 'Only you', glyph: 'lock' }
  }
  if (word === 'public') {
    return { label: 'Anyone with link', glyph: 'globe' }
  }
  if (word === 'org' || word === 'organization') {
    return { label: 'Anyone in your org', glyph: 'organization' }
  }
  return { label: 'People with access', glyph: 'users' }
}

export type ArtifactRowLines = {
  title: string
  /** Line 2: the audience (own rows, with its glyph) or who shared it (shared rows, no glyph). */
  who: { label: string; glyph: ClaudeCdsGlyphName | null } | null
  /** Line 3: "Edited 3h ago" or "Created 2d ago", or null when the row carries no date. */
  when: string | null
}

/**
 * A row's three lines. As the app: an own row is "Edited" by its `updatedAt`, a shared one
 * "Created" by its `created_at` (jp30.java:751, jbh.java:207). Code UI falls back to the other date
 * when the one the app reads is missing, rather than draw no time; the app has no such row to draw.
 */
export function artifactRowLines(item: ClaudeArtifactListItem, now: number): ArtifactRowLines {
  const who =
    item.rel === 'shared'
      ? { label: item.ownerEmail ? `By ${item.ownerEmail}` : 'Shared with you', glyph: null }
      : artifactAudienceView(item.audience)
  const [verb, at] = item.rel === 'mine' ? ['Edited', item.updatedAt ?? item.createdAt] : ['Created', item.createdAt ?? item.updatedAt]
  let when: string | null = null
  if (at !== null) {
    const ago = formatTimeAgo(at, now)
    when = ago === 'just now' ? `${verb} just now` : `${verb} ${ago} ago`
  }
  return { title: item.title, who, when }
}

/**
 * How a row's thumbnail is loaded: its URL and no headers at all. `thumbImgURL` is a signed
 * claudeusercontent.com URL that answered the same image with and without the bearer (P18,
 * 2026-10-16), and the Claude app loads `thumbnail_url` with Coil and no auth (jbh.java:1039-1075).
 * Kept as one function so that if a host ever does need the sign-in, the change is here. The URL's
 * query holds a token: it is never logged.
 */
export function artifactThumbnailSource(url: string | null): { uri: string } | null {
  if (!url) {
    return null
  }
  try {
    return new URL(url).protocol === 'https:' ? { uri: url } : null
  } catch {
    return null
  }
}
