export function normalizeBrowserUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || isBlankBrowserUrl(trimmed)) {
    return 'about:blank'
  }
  if (hasHttpLikeLocalHost(trimmed)) {
    try {
      return new URL(`http://${trimmed}`).toString()
    } catch {
      return null
    }
  }
  try {
    const parsed = new URL(trimmed)
    if (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'file:'
    ) {
      return parsed.toString()
    }
    // `example.com:8080` and `mymac:3000` parse with the "scheme" `example.com:`, so a dev server
    // typed without one was refused while the same host with no port opened (review, 2026-09-30).
    return isSchemelessHostWithPort(trimmed) ? withSchemeForHostPort(trimmed) : null
  } catch {
    // A value with a scheme that does not parse (`http://example.com:99999`, `http://a b`,
    // `https:`) is refused. Putting `https://` in front of it again opened a host named "http"
    // (review, 2026-09-30).
    if (SCHEME_PREFIX.test(trimmed)) {
      return null
    }
    // `8.8.8.8:53` and `my_host:3000` throw instead: no scheme can start with a digit or hold `_`.
    return isSchemelessHostWithPort(trimmed) ? withSchemeForHostPort(trimmed) : withHttps(trimmed)
  }
}

/** A URL scheme and its colon: a letter, then letters, digits, `+`, `-` or `.`. `my_host:3000`
 *  and `8.8.8.8:53` are not one, and fail to parse only for want of one. */
const SCHEME_PREFIX = /^[a-z][a-z\d+.-]*:/i

function withHttps(value: string): string | null {
  try {
    return new URL(`https://${value}`).toString()
  } catch {
    return null
  }
}

/** A host as the URL parser writes an IPv4 address: four decimal parts, whatever form was typed. */
const IPV4_HOSTNAME = /^\d{1,3}(?:\.\d{1,3}){3}$/

/**
 * A host:port typed with no scheme opens over plain http when its host is an IPv4 address or a
 * single label (no dot), and over https otherwise: the rule Chrome's typed-navigation
 * HTTPS-Upgrades use, which never upgrade an IP-address literal or a non-unique host name. A
 * dev server by machine name (`mymac:3000`), by LAN address or by Tailscale address
 * (100.64.0.0/10) serves plain http, and https:// against it failed the TLS handshake in the
 * browser pane (review, 2026-09-30). A dotted name (`example.com:8080`) keeps https.
 */
function withSchemeForHostPort(value: string): string | null {
  let plain: URL
  try {
    plain = new URL(`http://${value}`)
  } catch {
    // https:// parses the host and port the same way, and would refuse them too.
    return null
  }
  return IPV4_HOSTNAME.test(plain.hostname) || !plain.hostname.includes('.')
    ? plain.toString()
    : withHttps(value)
}

/** Schemes whose body can be all digits, which a host:port reading would open as a web page. */
const DIGIT_BODIED_SCHEMES = new Set(['tel', 'sms', 'mms', 'fax', 'callto'])

function isSchemelessHostWithPort(value: string): boolean {
  const match = /^([\w.-]+):\d+(?:[/?#]|$)/.exec(value)
  return match !== null && !DIGIT_BODIED_SCHEMES.has(match[1]!.toLowerCase())
}

export function displayBrowserUrl(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? ''
  return isBlankBrowserUrl(trimmed) ? 'about:blank' : trimmed
}

export function compactMobileBrowserFileAddress(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') {
      return null
    }
    const segments = url.pathname.split('/').filter(Boolean)
    const encodedFilename = segments.at(-1)
    if (!encodedFilename) {
      return 'file:'
    }
    try {
      return `file: …/${decodeURIComponent(encodedFilename)}`
    } catch {
      return `file: …/${encodedFilename}`
    }
  } catch {
    return null
  }
}

export function isBlankBrowserUrl(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? ''
  return !trimmed || trimmed === 'about:blank' || trimmed.startsWith('data:text/html')
}

/** localhost, 127.x, a bracketed IPv6 address and a `.local` name: plain http, with a port or
 *  without. A LAN address (10/8, 172.16/12, 192.168/16) with a port was matched here too; every
 *  IPv4 address with a port now opens over http by the host:port rule (withSchemeForHostPort). */
function hasHttpLikeLocalHost(value: string): boolean {
  return (
    /^(localhost|127(?:\.\d{1,3}){3}|\[[0-9a-f:]+\])(?::\d+)?(?:[/?#].*)?$/i.test(value) ||
    /^[\w.-]+\.local(?::\d+)?(?:[/?#].*)?$/i.test(value)
  )
}
