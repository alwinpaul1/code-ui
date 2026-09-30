import { describe, expect, it } from 'vitest'

import { compactMobileBrowserFileAddress, normalizeBrowserUrl } from './browser-url'

describe('normalizeBrowserUrl', () => {
  it('keeps localhost-style addresses as http URLs', () => {
    expect(normalizeBrowserUrl('localhost:3000')).toBe('http://localhost:3000/')
    expect(normalizeBrowserUrl('127.0.0.1:6769/web-index.html')).toBe(
      'http://127.0.0.1:6769/web-index.html'
    )
  })

  it('adds https for regular domains without a scheme', () => {
    expect(normalizeBrowserUrl('github.com/stablyai/orca')).toBe('https://github.com/stablyai/orca')
  })

  it('opens a dev server typed as host:port with no scheme, instead of opening nothing', () => {
    // Review 2026-09-30: new URL('example.com:8080') parses with the protocol 'example.com:', so
    // the address bar and the new-tab prompt refused it while the same host with no port opened.
    expect(normalizeBrowserUrl('example.com:8080/docs')).toBe('https://example.com:8080/docs')
    expect(normalizeBrowserUrl('mymac:3000')).toBe('https://mymac:3000/')
    expect(normalizeBrowserUrl('mymac:3000?tab=2')).toBe('https://mymac:3000/?tab=2')
  })

  it('opens a LAN dev server by private address and port over plain http, as localhost is', () => {
    expect(normalizeBrowserUrl('192.168.1.5:3000')).toBe('http://192.168.1.5:3000/')
    expect(normalizeBrowserUrl('10.0.0.2:8080/app')).toBe('http://10.0.0.2:8080/app')
    expect(normalizeBrowserUrl('172.16.0.1:5173')).toBe('http://172.16.0.1:5173/')
    expect(normalizeBrowserUrl('172.31.255.1:5173')).toBe('http://172.31.255.1:5173/')
    // Just outside 172.16/12 is a public address, and keeps https.
    expect(normalizeBrowserUrl('172.32.0.1:8080')).toBe('https://172.32.0.1:8080/')
  })

  it('keeps refusing or opening what it did before for a scheme, a bare word and nothing', () => {
    expect(normalizeBrowserUrl('mailto:x')).toBeNull()
    expect(normalizeBrowserUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeBrowserUrl('tel:123')).toBeNull()
    expect(normalizeBrowserUrl('file:///tmp/a.html')).toBe('file:///tmp/a.html')
    expect(normalizeBrowserUrl('about:blank')).toBe('about:blank')
    expect(normalizeBrowserUrl('hello')).toBe('https://hello/')
    expect(normalizeBrowserUrl('')).toBe('about:blank')
    expect(normalizeBrowserUrl(':3000')).toBeNull()
    expect(normalizeBrowserUrl('mymac:99999')).toBeNull()
  })
})

// Review 2026-09-30: when new URL() threw for an address that already had a scheme (an
// out-of-range port, a space in the host), the fallback put `https://` in front of it again, and
// the browser was sent to a host named literally "http" or "https", a wrong site or an error page,
// instead of the address bar saying the URL was not valid.
describe('an address typed with a scheme that does not parse', () => {
  it('is refused, not opened on a host named after its scheme', () => {
    expect(normalizeBrowserUrl('http://example.com:99999')).toBeNull()
    expect(normalizeBrowserUrl('http://a b')).toBeNull()
    expect(normalizeBrowserUrl('https://x:0x')).toBeNull()
    expect(normalizeBrowserUrl('http:// example.com')).toBeNull()
    expect(normalizeBrowserUrl('file://a b')).toBeNull()
    expect(normalizeBrowserUrl('ws://a b')).toBeNull()
  })

  it('is refused whatever the case of its scheme', () => {
    expect(normalizeBrowserUrl('HTTP://A B')).toBeNull()
    expect(normalizeBrowserUrl('Http://Example.com:99999/x')).toBeNull()
  })

  it('is refused when the scheme has no host after it at all', () => {
    expect(normalizeBrowserUrl('http://')).toBeNull()
    expect(normalizeBrowserUrl('https:')).toBeNull()
    expect(normalizeBrowserUrl('http:/')).toBeNull()
  })

  it('still opens what parses, and still adds https to a host typed with no scheme', () => {
    expect(normalizeBrowserUrl('HTTP://Example.com:8080/x')).toBe('http://example.com:8080/x')
    expect(normalizeBrowserUrl('file://')).toBe('file:///')
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com/')
    expect(normalizeBrowserUrl('mymac:3000')).toBe('https://mymac:3000/')
    expect(normalizeBrowserUrl('localhost:3000')).toBe('http://localhost:3000/')
    // Not schemes: an underscore cannot be in one, and one cannot start with a digit.
    expect(normalizeBrowserUrl('my_host:3000')).toBe('https://my_host:3000/')
    expect(normalizeBrowserUrl('8.8.8.8:53')).toBe('https://8.8.8.8:53/')
    expect(normalizeBrowserUrl('mymac:99999')).toBeNull()
    expect(normalizeBrowserUrl('tel:123')).toBeNull()
    expect(normalizeBrowserUrl('   ')).toBe('about:blank')
  })
})

describe('compactMobileBrowserFileAddress', () => {
  it('shows the decoded filename for local and Windows-style file URLs', () => {
    expect(compactMobileBrowserFileAddress('file:///Users/me/reports/status%20report.html')).toBe(
      'file: …/status report.html'
    )
    expect(compactMobileBrowserFileAddress('file:///C:/Users/me/report.htm')).toBe(
      'file: …/report.htm'
    )
  })

  it('does not compact ordinary or malformed URLs', () => {
    expect(compactMobileBrowserFileAddress('https://example.com/report.html')).toBeNull()
    expect(compactMobileBrowserFileAddress('not a url')).toBeNull()
  })
})
