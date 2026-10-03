import { describe, expect, it } from 'vitest'
import { normalizeCodeUiReleaseUrl } from './code-ui-release-url'

const RELEASES = 'https://github.com/alwinpaul1/code-ui/releases'

describe('a release link the wall may open', () => {
  it.each([
    [RELEASES, RELEASES],
    [`${RELEASES}/`, `${RELEASES}/`],
    [`${RELEASES}/tag/mobile-android-v0.9.200`, `${RELEASES}/tag/mobile-android-v0.9.200`],
    // Dot segments collapse first, and the link opened is the collapsed one.
    [`${RELEASES}/./tag/mobile-android-v0.9.200`, `${RELEASES}/tag/mobile-android-v0.9.200`],
    [`${RELEASES}/tag/x/../mobile-android-v0.9.200`, `${RELEASES}/tag/mobile-android-v0.9.200`]
  ])('accepts %s', (input, expected) => {
    expect(normalizeCodeUiReleaseUrl(input)).toBe(expected)
  })

  it.each([
    [
      'dot segments that climb out of the releases path',
      `${RELEASES}/../../../stablyai/orca/releases`
    ],
    ['encoded dot segments that climb out', `${RELEASES}/%2e%2e/%2e%2e/orca/releases`],
    ['a sibling repo sharing the prefix', 'https://github.com/alwinpaul1/code-ui-evil/releases'],
    ['another owner', 'https://github.com/stablyai/orca/releases/tag/v1.4.219'],
    ['another host', 'https://evil.example/alwinpaul1/code-ui/releases'],
    [
      'credentials that move the host',
      'https://github.com@evil.example/alwinpaul1/code-ui/releases'
    ],
    [
      'a userinfo before the real host',
      'https://alwinpaul1:x@github.com/alwinpaul1/code-ui/releases'
    ],
    ['a port', 'https://github.com:8443/alwinpaul1/code-ui/releases'],
    ['a query', `${RELEASES}?next=https://evil.example`],
    ['a fragment', `${RELEASES}#frag`],
    ['an encoded slash in the path', `${RELEASES}/tag/a%2F..%2F..%2Forca`],
    ['an encoded backslash in the path', `${RELEASES}/tag/a%5C..%5Corca`],
    ['plain http', 'http://github.com/alwinpaul1/code-ui/releases'],
    ['a different scheme', 'javascript:alert(1)//github.com/alwinpaul1/code-ui/releases'],
    [
      'a host that only looks like github.com',
      'https://github.com.evil.example/alwinpaul1/code-ui/releases'
    ],
    ['text that is not a URL', 'not a url'],
    ['a non-string', 42],
    ['nothing', undefined]
  ])('refuses %s', (_why, input) => {
    expect(normalizeCodeUiReleaseUrl(input)).toBeNull()
  })

  it('judges the link as the browser will read it, not as the string looks', () => {
    // A backslash is a slash to the URL parser, so this is the sibling repo, not the releases page.
    expect(
      normalizeCodeUiReleaseUrl('https://github.com/alwinpaul1\\code-ui-evil\\releases')
    ).toBeNull()
  })
})
