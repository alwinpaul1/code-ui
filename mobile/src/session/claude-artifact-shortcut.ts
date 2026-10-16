import { requireOptionalNativeModule } from 'expo-modules-core'
import { parseClaudeArtifactLink } from './claude-artifacts'
import { artifactShortcutKey } from './claude-artifact-shortcut-key'

// ─── "Add to home screen" for a claude.ai artifact ───────────────────────────
//
// The Claude Android app 1.261013.20 pins a launcher shortcut per artifact
// (m2d.java:1466-1505, sc1.java:18): id
// `artifact_page_{accountId}_{orgId}_{artifactId}`, both labels the title,
// intent VIEW to its own ArtifactAppActivity. Code UI has one activity and no
// per-account standalone viewer, so its shortcut is named by the artifact
// alone (`artifact_page_<uuid>`; the same artifact pinned from two accounts is
// one shortcut) and opens a `codeui://artifact?url=…&title=…&k=…` link, which
// app/+native-intent.tsx turns into the `/artifact` route's params. `k` is the
// install's shortcut key (claude-artifact-shortcut-key.ts): the only thing that
// lets an app-scheme link open without "Open this artifact?", since any other
// app can fire the scheme. With no key kept, the shortcut asks every time.
//
// The pin itself is modules/orca-artifact-shortcuts (Android). Anywhere it is
// absent (web, iOS, tests) the answer is 'unsupported'.

export type ClaudeArtifactShortcutResult = 'pinned' | 'already' | 'unsupported' | 'failed'

export const ARTIFACT_SHORTCUTS_MODULE = 'OrcaArtifactShortcuts'

/**
 * The short label's cap. Android documents no hard limit (ShortcutInfo.Builder recommends 10
 * characters for the short label and 25 for the long one) and launchers ellipsize; 25 keeps a
 * long title from being cut by the launcher mid-glyph while the long label keeps all of it.
 */
export const SHORTCUT_SHORT_LABEL_MAX = 25

/** The label a shortcut gets when the artifact has no title: Android refuses an empty one. */
const UNTITLED_LABEL = 'Artifact'

type NativeArtifactShortcuts = {
  requestPinShortcut(id: string, shortLabel: string, longLabel: string, uri: string): Promise<string>
}

const RESULTS = new Set<string>(['pinned', 'already', 'unsupported', 'failed'])

/** The launcher shortcut's id for an artifact, keyed by its uuid. */
export function claudeArtifactShortcutId(uuid: string): string {
  return `artifact_page_${uuid}`
}

/** The deep link the shortcut opens: the artifact viewer route with its link, title and key. */
export function claudeArtifactShortcutUri(url: string, title: string, key: string | null): string {
  const base = `codeui://artifact?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`
  return key ? `${base}&k=${encodeURIComponent(key)}` : base
}

/** The title as one line, or the untitled label when nothing is left of it. */
function longLabelOf(title: string): string {
  const label = title.replace(/\s+/g, ' ').trim()
  return label.length > 0 ? label : UNTITLED_LABEL
}

/** The long label cut to the short label's cap, by code point so no emoji is split. */
function shortLabelOf(longLabel: string): string {
  const chars = Array.from(longLabel)
  if (chars.length <= SHORTCUT_SHORT_LABEL_MAX) {
    return longLabel
  }
  return `${chars.slice(0, SHORTCUT_SHORT_LABEL_MAX - 1).join('').trimEnd()}…`
}

/**
 * Asks the launcher to pin a home-screen shortcut to the artifact at `url`. 'pinned' means the
 * request was accepted and Android's own confirm dialog follows; 'already' that one is on the
 * home screen now; 'unsupported' that this launcher or platform cannot pin; 'failed' anything
 * else, including a link that is not a claude.ai artifact.
 */
export async function pinClaudeArtifactShortcut(args: {
  url: string
  title: string
}): Promise<'pinned' | 'already' | 'unsupported' | 'failed'> {
  const native = requireOptionalNativeModule<NativeArtifactShortcuts>(ARTIFACT_SHORTCUTS_MODULE)
  if (native === null) {
    return 'unsupported'
  }
  const link = parseClaudeArtifactLink(args.url)
  if (link === null) {
    console.warn(`${ARTIFACT_SHORTCUTS_MODULE}: not a claude.ai artifact link, no shortcut pinned`)
    return 'failed'
  }
  const longLabel = longLabelOf(args.title)
  const key = await artifactShortcutKey()
  try {
    const result = await native.requestPinShortcut(
      claudeArtifactShortcutId(link.uuid),
      shortLabelOf(longLabel),
      longLabel,
      claudeArtifactShortcutUri(link.url, longLabel, key)
    )
    if (RESULTS.has(result)) {
      return result as ClaudeArtifactShortcutResult
    }
    console.warn(`${ARTIFACT_SHORTCUTS_MODULE}.requestPinShortcut answered ${String(result)}`)
    return 'failed'
  } catch (error) {
    console.warn(`${ARTIFACT_SHORTCUTS_MODULE}.requestPinShortcut threw: ${String(error)}`)
    return 'failed'
  }
}
