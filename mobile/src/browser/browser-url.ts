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
    return isSchemelessHostWithPort(trimmed) ? withHttps(trimmed) : null
  } catch {
    // A value with a scheme that does not parse (`http://example.com:99999`, `http://a b`,
    // `https:`) is refused. Putting `https://` in front of it again opened a host named "http"
    // (review, 2026-09-30).
    return SCHEME_PREFIX.test(trimmed) ? null : withHttps(trimmed)
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

/** A LAN address with a port is a dev server, and those serve plain http, as localhost does. */
const PRIVATE_IPV4_WITH_PORT =
  /^(?:10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2}):\d+(?:[/?#].*)?$/

function hasHttpLikeLocalHost(value: string): boolean {
  return (
    /^(localhost|127(?:\.\d{1,3}){3}|\[[0-9a-f:]+\])(?::\d+)?(?:[/?#].*)?$/i.test(value) ||
    /^[\w.-]+\.local(?::\d+)?(?:[/?#].*)?$/i.test(value) ||
    PRIVATE_IPV4_WITH_PORT.test(value)
  )
}
