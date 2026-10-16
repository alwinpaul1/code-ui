import { parseClaudeArtifactLink } from './claude-artifacts'

// ─── Links into the artifact viewer, as Expo Router receives them ────────────
//
// app/+native-intent.tsx runs every URL the system hands the app through
// redirectArtifactSystemPath before Expo Router matches it to a route. Two
// kinds are rewritten; every other one comes back exactly as it went in.
//
// 1. A claude.ai artifact link opened from another app. app.json gives
//    MainActivity a VIEW/BROWSABLE https filter for host claude.ai, path
//    prefixes /artifact/, /code/artifact/ and /code/frame/ — the paths the
//    Claude Android app 1.261013.20 claims (AndroidManifest.xml:242-275). The
//    Claude app verifies that filter (autoVerify); Code UI cannot verify
//    claude.ai, so its filter is unverified, and Android 12+ routes these links
//    to Code UI ONLY after the user turns on "Open supported links" for it in
//    the app's settings (or picks it in a chooser). Unrewritten, Expo Router
//    would match `/artifact/<id>` as a path and show its not-found screen; it
//    goes to `/artifact?url=<the link>&external=1`, and the viewer asks before
//    loading a page another app sent. preview.claude.ai is not rewritten: the
//    filter does not claim it, so it can only arrive by some other door.
//    A claude.ai link under those prefixes whose id does not decode goes home
//    (`/`): the viewer route would hand an unreadable link to the browser, and
//    with supported links on, Android would hand it straight back here.
//
// 2. An app-scheme link to the viewer: `codeui://artifact?…`, `orca://artifact?…`,
//    the empty-host `codeui:///artifact?…` and a bare `/artifact?…` path. The
//    home-screen shortcut opens one (claude-artifact-shortcut.ts), but both
//    schemes are exported and any installed app can fire them (review
//    2026-10-16), so every one is marked `external=1` whatever it says, and only
//    the shortcut's key (`k`, claude-artifact-shortcut-key.ts), checked by the
//    route, lets it open without asking. Expo Router reads a scheme URL's query by
//    decoding each value and joining them back UNENCODED
//    (expo-router/build/fork/extractPathFromURL.js, fromDeepLink), so an `&`
//    in a title or a share key would split it into another param. A path that
//    starts with `/` is taken as it is, so the link is rebuilt as
//    `/artifact?…` with every value encoded once.

const EXTERNAL_PATH_PREFIXES = ['/artifact/', '/code/artifact/', '/code/frame/']
const APP_SCHEMES = new Set(['codeui:', 'orca:'])

function query(params: Iterable<[string, string]>): string {
  return Array.from(params, ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join(
    '&'
  )
}

function rewrite(path: string): string {
  const trimmed = path.trim()
  const routed = routerPathToViewer(trimmed)
  if (routed !== null) {
    return routed
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return path
  }
  const protocol = url.protocol.toLowerCase()
  if (protocol === 'https:') {
    if (
      url.hostname.toLowerCase() !== 'claude.ai' ||
      !EXTERNAL_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
    ) {
      return path
    }
    if (parseClaudeArtifactLink(trimmed) === null) {
      return '/'
    }
    return `/artifact?${query([
      ['url', trimmed],
      ['external', '1']
    ])}`
  }
  const host = url.hostname.toLowerCase()
  if (APP_SCHEMES.has(protocol) && ((host === 'artifact' && (url.pathname === '' || url.pathname === '/')) || (host === '' && url.pathname === '/artifact'))) {
    return toViewer(url.searchParams)
  }
  return path
}

/** The viewer route with the link's params, marked as from outside whatever they said. */
function toViewer(params: URLSearchParams): string {
  const kept = Array.from(params.entries()).filter(([key]) => key !== 'external')
  return `/artifact?${query([...kept, ['external', '1']])}`
}

/** A router path (no scheme) naming the viewer, as `/artifact?…` or `artifact?…`. */
function routerPathToViewer(path: string): string | null {
  const match = /^\/?artifact(?:\/)?(\?.*)?$/.exec(path)
  if (match === null) {
    return null
  }
  return toViewer(new URLSearchParams(match[1] ?? ''))
}

/**
 * The path Expo Router should open for a URL the system delivered. Never throws: anything it
 * cannot read comes back unchanged.
 */
export function redirectArtifactSystemPath(path: string): string {
  if (typeof path !== 'string') {
    return path
  }
  try {
    return rewrite(path)
  } catch {
    return path
  }
}
