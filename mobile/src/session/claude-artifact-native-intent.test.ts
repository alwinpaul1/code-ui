/**
 * What Expo Router opens for a URL the system hands the app (app/+native-intent.tsx). The
 * routing half is read with expo-router's own code (extractExpoPathFromURL, then the query as its
 * getStateFromPath reads it), so these pin the screen a link lands on, not just a string.
 */
import { describe, expect, it } from 'vitest'
import { extractExpoPathFromURL } from 'expo-router/build/fork/extractPathFromURL'
import { redirectSystemPath } from '../../app/+native-intent'
import { redirectArtifactSystemPath } from './claude-artifact-native-intent'
import { PUBLISHED_LINK, PUBLISHED_UUID } from './fixtures/claude-artifact-tool-2.1.301'

const readPath = (prefixes: string[], url: string): string => extractExpoPathFromURL(prefixes, url)

/** The route and params Expo Router resolves for a delivered URL, +native-intent included. */
function landsOn(delivered: string): { pathname: string; params: Record<string, string> } {
  let path = readPath([], redirectSystemPath({ path: delivered, initial: true }))
  if (!path.startsWith('/')) {
    path = `/${path}`
  }
  const url = new URL(path, 'file:')
  return { pathname: url.pathname, params: Object.fromEntries(url.searchParams.entries()) }
}

const viewer = (url: string) => ({ pathname: '/artifact', params: { url, external: '1' } })

describe('a claude.ai artifact link opened from another app', () => {
  it('opens /artifact/<id> in the viewer, marked as from outside', () => {
    expect(landsOn(PUBLISHED_LINK)).toEqual(viewer(PUBLISHED_LINK))
  })

  it('opens /code/artifact/<slug-uuid> in the viewer', () => {
    const link = `https://claude.ai/code/artifact/release-dashboard-${PUBLISHED_UUID}`
    expect(landsOn(link)).toEqual(viewer(link))
  })

  it('opens the older /code/frame/<id> in the viewer', () => {
    const link = 'https://claude.ai/code/frame/8JHvPGXwg2SLbchagvbYU6'
    expect(landsOn(link)).toEqual(viewer(link))
  })

  it('keeps a share key with an & in it on the link the viewer gets', () => {
    const link = `${PUBLISHED_LINK}?sk=abc&utm=x+y`
    expect(landsOn(link)).toEqual(viewer(link))
  })

  it('goes home for an artifact-shaped claude.ai link whose id does not decode', () => {
    expect(redirectArtifactSystemPath('https://claude.ai/artifact/not-base58-0OIl')).toBe('/')
    expect(redirectArtifactSystemPath(`${PUBLISHED_LINK}/extra`)).toBe('/')
  })
})

describe('links it leaves alone', () => {
  it('does not rewrite preview.claude.ai, which the intent filter does not claim', () => {
    const link = 'https://preview.claude.ai/artifact/8JHvPGXwg2SLbchagvbYU6'
    expect(redirectArtifactSystemPath(link)).toBe(link)
  })

  it('does not rewrite other claude.ai pages or other hosts', () => {
    for (const link of [
      'https://claude.ai/chat/abc',
      'https://claude.ai/artifacts',
      'http://claude.ai/artifact/8JHvPGXwg2SLbchagvbYU6',
      'https://evil.example/artifact/8JHvPGXwg2SLbchagvbYU6',
      'https://claude.ai.evil.example/artifact/8JHvPGXwg2SLbchagvbYU6'
    ]) {
      expect(redirectArtifactSystemPath(link)).toBe(link)
    }
  })

  it('leaves pairing links exactly as they were', () => {
    for (const link of ['orca://pair?code=ABC-123', 'codeui://pair?code=ABC%2B123', 'orca://pair#ABC']) {
      expect(redirectSystemPath({ path: link, initial: true })).toBe(link)
      expect(redirectSystemPath({ path: link, initial: false })).toBe(link)
    }
  })

  it('leaves other app links and router paths exactly as they were', () => {
    for (const link of ['codeui://h/host-1?worktree=w', '/h/host-1', '/', '/artifacts', 'codeui://artifacts', '/artifact-x?url=a', 'exp+code-ui://expo-development-client/?url=x']) {
      expect(redirectArtifactSystemPath(link)).toBe(link)
    }
  })

  it('returns malformed input unchanged instead of throwing', () => {
    for (const link of ['', '   ', 'not a url', 'https://', '://artifact', 'codeui://']) {
      expect(redirectArtifactSystemPath(link)).toBe(link)
    }
    expect(redirectArtifactSystemPath(undefined as unknown as string)).toBeUndefined()
    expect(redirectArtifactSystemPath(42 as unknown as string)).toBe(42)
  })
})

describe('the home-screen shortcut link', () => {
  const shortcut = `codeui://artifact?url=${encodeURIComponent(`${PUBLISHED_LINK}?sk=a+b&x=1`)}&title=${encodeURIComponent('Q&A board #2 100%')}&k=key-1`

  it('reaches the viewer with the share key, an & in the title and its own key intact, still marked as from outside', () => {
    expect(landsOn(shortcut)).toEqual({
      pathname: '/artifact',
      params: { url: `${PUBLISHED_LINK}?sk=a+b&x=1`, title: 'Q&A board #2 100%', k: 'key-1', external: '1' }
    })
  })

  it('would lose the title past its & without the rewrite (Expo Router decodes a scheme URL query unencoded)', () => {
    const url = new URL(`/${readPath([], shortcut)}`, 'file:')
    expect(url.searchParams.get('title')).not.toBe('Q&A board #2 100%')
  })

  it('reads the orca scheme the same way', () => {
    expect(landsOn(`orca://artifact?url=${encodeURIComponent(PUBLISHED_LINK)}`)).toEqual(viewer(PUBLISHED_LINK))
  })

  it('opens the bare route, marked as from outside, when the link carries no params', () => {
    expect(redirectArtifactSystemPath('codeui://artifact')).toBe('/artifact?external=1')
  })
})

// Review 2026-10-16: both schemes are exported, so any installed app can fire them. Only the
// route's own check of the shortcut key (claude-artifact-shortcut-key.ts) may skip the question.
describe('an app-scheme link another app fires', () => {
  for (const [name, delivered] of [
    ['codeui://artifact', `codeui://artifact?url=${encodeURIComponent(PUBLISHED_LINK)}`],
    ['orca://artifact', `orca://artifact?url=${encodeURIComponent(PUBLISHED_LINK)}`],
    ['codeui:///artifact (empty host)', `codeui:///artifact?url=${encodeURIComponent(PUBLISHED_LINK)}`],
    ['codeui:/artifact', `codeui:/artifact?url=${encodeURIComponent(PUBLISHED_LINK)}`],
    ['a link that says external=0', `codeui://artifact?url=${encodeURIComponent(PUBLISHED_LINK)}&external=0`],
    ['a link that says external twice', `codeui://artifact?external=0&url=${encodeURIComponent(PUBLISHED_LINK)}&external=0`]
  ]) {
    it(`still asks before opening: ${name}`, () => {
      expect(landsOn(delivered)).toEqual(viewer(PUBLISHED_LINK))
    })
  }

  it('marks a bare router path to the viewer as from outside too', () => {
    expect(landsOn(`/artifact?url=${encodeURIComponent(PUBLISHED_LINK)}&external=0`)).toEqual(viewer(PUBLISHED_LINK))
  })
})
