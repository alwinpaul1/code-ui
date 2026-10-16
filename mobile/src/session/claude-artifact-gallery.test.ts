import { describe, expect, it } from 'vitest'
import {
  ARTIFACTS_EMPTY_TEXT,
  DEFAULT_ARTIFACT_GALLERY_FILTERS,
  NO_ARTIFACTS_MATCH_TEXT,
  artifactAudienceView,
  artifactGalleryEmptyText,
  artifactRowLines,
  artifactThumbnailSource,
  artifactTypeOptions,
  filterArtifactGallery,
  type ArtifactGalleryFilters
} from './claude-artifact-gallery'
import type { ClaudeArtifactListItem } from './claude-artifacts'

// What the Artifacts gallery shows (the Claude app's Artifacts tab, xo30.java / jbh.java), without
// drawing it: the list and type dropdowns, the search, each row's three lines, and the thumbnail.

const NOW = Date.parse('2026-10-16T15:00:00Z')

function row(over: Partial<ClaudeArtifactListItem> & { uuid: string; title: string }): ClaudeArtifactListItem {
  return {
    rel: 'mine',
    updatedAt: null,
    url: `https://claude.ai/artifact/${over.uuid}`,
    createdAt: null,
    audience: null,
    typeTitle: null,
    typeSlug: null,
    thumbUrl: null,
    starred: false,
    ownerEmail: null,
    ...over
  }
}

const DASHBOARD = row({ uuid: 'a1', title: 'Release dashboard', typeTitle: 'Design', starred: true })
const NOTES = row({ uuid: 'a2', title: 'Meeting notes' })
const ROADMAP = row({ uuid: 'a3', title: 'Team roadmap', rel: 'shared', typeTitle: 'Slides' })
const ALL = [DASHBOARD, NOTES, ROADMAP]
const titles = (items: readonly ClaudeArtifactListItem[]) => items.map((item) => item.title)
const filters = (over: Partial<ArtifactGalleryFilters>): ArtifactGalleryFilters => ({ ...DEFAULT_ARTIFACT_GALLERY_FILTERS, ...over })

describe('the list dropdown', () => {
  it('shows every row under All, the starred under Pinned, own under Yours and the rest under Shared with you', () => {
    expect(titles(filterArtifactGallery(ALL, filters({ list: 'all' })))).toEqual(['Release dashboard', 'Meeting notes', 'Team roadmap'])
    expect(titles(filterArtifactGallery(ALL, filters({ list: 'pinned' })))).toEqual(['Release dashboard'])
    expect(titles(filterArtifactGallery(ALL, filters({ list: 'yours' })))).toEqual(['Release dashboard', 'Meeting notes'])
    expect(titles(filterArtifactGallery(ALL, filters({ list: 'shared' })))).toEqual(['Team roadmap'])
  })

  it('shows nothing under Pinned when no row is starred, as P18 found the live list', () => {
    expect(filterArtifactGallery([NOTES], filters({ list: 'pinned' }))).toEqual([])
  })
})

describe('the type dropdown', () => {
  it('is not offered when no row names a type', () => {
    expect(artifactTypeOptions([NOTES])).toBeNull()
    expect(artifactTypeOptions([])).toBeNull()
  })

  it('offers All types, each type once in list order, then Other for rows with none', () => {
    expect(artifactTypeOptions([...ALL, row({ uuid: 'a4', title: 'Second design', typeTitle: 'Design' })])?.map((option) => option.label)).toEqual([
      'All types',
      'Design',
      'Slides',
      'Other'
    ])
  })

  it('offers no Other when every row has a type, even with only one row', () => {
    expect(artifactTypeOptions([DASHBOARD])?.map((option) => option.label)).toEqual(['All types', 'Design'])
  })

  it('narrows to one type, or to the untyped rows under Other', () => {
    expect(titles(filterArtifactGallery(ALL, filters({ type: { kind: 'type', title: 'Slides' } })))).toEqual(['Team roadmap'])
    expect(titles(filterArtifactGallery(ALL, filters({ type: { kind: 'other' } })))).toEqual(['Meeting notes'])
  })
})

describe('the search', () => {
  it('matches the title whatever its case, and ignores spaces around the words', () => {
    expect(titles(filterArtifactGallery(ALL, filters({ query: '  ROAD ' })))).toEqual(['Team roadmap'])
    expect(titles(filterArtifactGallery(ALL, filters({ query: 'zzz' })))).toEqual([])
  })

  it('combines with the dropdowns', () => {
    expect(titles(filterArtifactGallery(ALL, filters({ list: 'yours', query: 'road' })))).toEqual([])
  })
})

describe('an empty gallery', () => {
  it('welcomes with nothing chosen, and says nothing matches once something is', () => {
    expect(artifactGalleryEmptyText(DEFAULT_ARTIFACT_GALLERY_FILTERS)).toBe(ARTIFACTS_EMPTY_TEXT)
    expect(ARTIFACTS_EMPTY_TEXT).toBe('Artifacts you’ve had with Claude will show up here.')
    expect(artifactGalleryEmptyText(filters({ list: 'pinned' }))).toBe(NO_ARTIFACTS_MATCH_TEXT)
    expect(artifactGalleryEmptyText(filters({ type: { kind: 'other' } }))).toBe('No artifacts match')
    expect(artifactGalleryEmptyText(filters({ query: 'x' }))).toBe('No artifacts match')
    expect(artifactGalleryEmptyText(filters({ query: '   ' }))).toBe(ARTIFACTS_EMPTY_TEXT)
  })
})

describe("a row's lines", () => {
  it('names who can open an own artifact, with the glyph the app draws', () => {
    expect(artifactAudienceView('owner')).toEqual({ label: 'Only you', glyph: 'lock' })
    expect(artifactAudienceView('public')).toEqual({ label: 'Anyone with link', glyph: 'globe' })
    expect(artifactAudienceView('org')).toEqual({ label: 'Anyone in your org', glyph: 'organization' })
    expect(artifactAudienceView('organization')).toEqual({ label: 'Anyone in your org', glyph: 'organization' })
    expect(artifactAudienceView('users')).toEqual({ label: 'People with access', glyph: 'users' })
    expect(artifactAudienceView('shared')).toEqual({ label: 'People with access', glyph: 'users' })
    expect(artifactAudienceView(null)).toBeNull()
    expect(artifactAudienceView('')).toBeNull()
  })

  it('says Edited by the update time for an own row', () => {
    expect(artifactRowLines(row({ uuid: 'a', title: 'Mine', audience: 'owner', updatedAt: NOW - 3 * 3_600_000, createdAt: NOW - 9 * 86_400_000 }), NOW)).toEqual({
      title: 'Mine',
      who: { label: 'Only you', glyph: 'lock' },
      when: 'Edited 3h ago'
    })
  })

  it('says By the owner and Created by the creation time for a shared row, with no glyph', () => {
    expect(artifactRowLines(row({ uuid: 'a', title: 'Theirs', rel: 'shared', ownerEmail: 'ada@example.com', createdAt: NOW - 2 * 86_400_000, updatedAt: NOW }), NOW)).toEqual({
      title: 'Theirs',
      who: { label: 'By ada@example.com', glyph: null },
      when: 'Created 2d ago'
    })
  })

  it('says Shared with you when a shared row names nobody', () => {
    expect(artifactRowLines(row({ uuid: 'a', title: 'Theirs', rel: 'shared' }), NOW).who).toEqual({ label: 'Shared with you', glyph: null })
  })

  it('falls back to the other date, and draws no time with neither', () => {
    expect(artifactRowLines(row({ uuid: 'a', title: 'x', createdAt: NOW - 30_000 }), NOW).when).toBe('Edited just now')
    expect(artifactRowLines(row({ uuid: 'a', title: 'x', rel: 'shared', updatedAt: NOW - 120_000 }), NOW).when).toBe('Created 2m ago')
    expect(artifactRowLines(row({ uuid: 'a', title: 'x' }), NOW)).toEqual({ title: 'x', who: null, when: null })
  })
})

describe('a thumbnail', () => {
  it('loads its signed URL with no headers at all (P18: the same image with and without the bearer)', () => {
    const url = 'https://a0000000-0000-4000-8000-000000000001.frame.claudeusercontent.com/_f/3/_thumb.img?__frame_t=TOKEN'
    expect(artifactThumbnailSource(url)).toEqual({ uri: url })
    expect(artifactThumbnailSource('https://api.anthropic.com/thumb.png')).toEqual({ uri: 'https://api.anthropic.com/thumb.png' })
  })

  it('loads nothing for no URL, a broken one, or one that is not https', () => {
    expect(artifactThumbnailSource(null)).toBeNull()
    expect(artifactThumbnailSource('not a url')).toBeNull()
    expect(artifactThumbnailSource('http://example.com/a.png')).toBeNull()
    expect(artifactThumbnailSource('file:///sdcard/a.png')).toBeNull()
  })
})
