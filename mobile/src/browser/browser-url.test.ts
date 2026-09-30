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
    expect(normalizeBrowserUrl('mymac:3000')).toBe('http://mymac:3000/')
    expect(normalizeBrowserUrl('mymac:3000?tab=2')).toBe('http://mymac:3000/?tab=2')
  })

  it('opens a LAN dev server by private address and port over plain http, as localhost is', () => {
    expect(normalizeBrowserUrl('192.168.1.5:3000')).toBe('http://192.168.1.5:3000/')
    expect(normalizeBrowserUrl('10.0.0.2:8080/app')).toBe('http://10.0.0.2:8080/app')
    expect(normalizeBrowserUrl('172.16.0.1:5173')).toBe('http://172.16.0.1:5173/')
    expect(normalizeBrowserUrl('172.31.255.1:5173')).toBe('http://172.31.255.1:5173/')
    // Just outside 172.16/12 is a public address, and still an address: http, as every IP with a
    // port is (it kept https until the review of 2026-09-30, below).
    expect(normalizeBrowserUrl('172.32.0.1:8080')).toBe('http://172.32.0.1:8080/')
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

  it('still opens what parses, and still adds a scheme to a host typed with none', () => {
    expect(normalizeBrowserUrl('HTTP://Example.com:8080/x')).toBe('http://example.com:8080/x')
    expect(normalizeBrowserUrl('file://')).toBe('file:///')
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com/')
    expect(normalizeBrowserUrl('mymac:3000')).toBe('http://mymac:3000/')
    expect(normalizeBrowserUrl('localhost:3000')).toBe('http://localhost:3000/')
    // Not schemes: an underscore cannot be in one, and one cannot start with a digit.
    expect(normalizeBrowserUrl('my_host:3000')).toBe('http://my_host:3000/')
    expect(normalizeBrowserUrl('8.8.8.8:53')).toBe('http://8.8.8.8:53/')
    expect(normalizeBrowserUrl('mymac:99999')).toBeNull()
    expect(normalizeBrowserUrl('tel:123')).toBeNull()
    expect(normalizeBrowserUrl('   ')).toBe('about:blank')
  })
})

// Review 2026-09-30 of d08e608f: the fix that let `mymac:3000` open at all opened it over https.
// A dev server serves plain http, so the page failed with a TLS error in the browser pane, and a
// Tailscale address (100.64.0.0/10) with a port did the same. Chrome's
// typed-navigation HTTPS-Upgrades leave IP-address literals and non-unique (single-label) host
// names on http; a host:port typed with no scheme now follows that rule.
describe('a host:port typed with no scheme', () => {
  it('opens a machine name with a port over plain http, which is what a dev server serves', () => {
    expect(normalizeBrowserUrl('mymac:3000')).toBe('http://mymac:3000/')
    expect(normalizeBrowserUrl('my_host:3000')).toBe('http://my_host:3000/')
    expect(normalizeBrowserUrl('MyMac:5173/app?x=1#top')).toBe('http://mymac:5173/app?x=1#top')
  })

  it('opens an IPv4 address with a port over plain http, a Tailscale or public one too', () => {
    expect(normalizeBrowserUrl('100.101.102.103:3000')).toBe('http://100.101.102.103:3000/')
    expect(normalizeBrowserUrl('8.8.8.8:53')).toBe('http://8.8.8.8:53/')
    expect(normalizeBrowserUrl('192.168.1.5:3000')).toBe('http://192.168.1.5:3000/')
  })

  it('keeps https for a dotted name with a port', () => {
    expect(normalizeBrowserUrl('example.com:8080')).toBe('https://example.com:8080/')
    expect(normalizeBrowserUrl('example.com:8080/docs')).toBe('https://example.com:8080/docs')
    expect(normalizeBrowserUrl('a.b:1')).toBe('https://a.b:1/')
  })

  it('keeps localhost and .local on http, and refuses a scheme whose body is digits', () => {
    expect(normalizeBrowserUrl('localhost:3000')).toBe('http://localhost:3000/')
    expect(normalizeBrowserUrl('mymac.local:3000')).toBe('http://mymac.local:3000/')
    for (const scheme of ['tel', 'sms', 'mms', 'fax', 'callto', 'TEL']) {
      expect(normalizeBrowserUrl(`${scheme}:5551234`)).toBeNull()
    }
  })

  it('reads the smallest shapes: a one-letter name, no host, and no port digits', () => {
    // A one-letter label is a host, not a scheme.
    expect(normalizeBrowserUrl('a:1')).toBe('http://a:1/')
    expect(normalizeBrowserUrl(':3000')).toBeNull()
    expect(normalizeBrowserUrl('mymac:')).toBeNull()
  })

  it('still refuses a port out of range, whatever the host', () => {
    expect(normalizeBrowserUrl('mymac:99999')).toBeNull()
    expect(normalizeBrowserUrl('8.8.8.8:99999')).toBeNull()
    expect(normalizeBrowserUrl('example.com:99999')).toBeNull()
  })

  it('leaves a name or address typed with no port on https, as before', () => {
    // Out of this fix's scope: the same rule would open these over http too.
    expect(normalizeBrowserUrl('hello')).toBe('https://hello/')
    expect(normalizeBrowserUrl('8.8.8.8')).toBe('https://8.8.8.8/')
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
