import type { NativeChatMessage, NativeChatToolCallBlock, NativeChatToolResultBlock } from '../../../src/shared/native-chat-types'
import { artifactCallView, type ClaudeArtifactListItem } from './claude-artifacts'
import { isArtifactToolName } from './mobile-native-chat-artifact-segment'

// ─── A Claude session's artifacts, for its Artifacts sheet ───────────────────
//
// The Claude Android app 1.261013.20 puts an "Open artifacts" button in the session's header
// (ns30.java:610-660, read `%d artifact(s)`), hidden while the session has none, and opens a sheet
// titled "Artifacts" (m74.java:179-190) listing them as cards subtitled "Artifact · claude.ai"
// (ds8.java:169), in the server's order, one card per URL. The app is told which artifacts a
// session made by its server; nothing the phone can read says that (the account's list names no
// session, claude-artifacts.ts), so Code UI reads them from the conversation: every Artifact call
// that published a page.
//
// Only the session's own pages, as in the app. The account's list (`/api/frame/frames`) gives them
// their real titles and nothing else here: listing the account's other pages under every session
// was tried and withdrawn on 2026-10-16 (a session that had made nothing showed all 8 of the
// account's). The account's pages, across every signed-in account, are the gallery's
// (ClaudeArtifactGallery.tsx).

/** One page this session published. */
export type SessionArtifact = {
  uuid: string
  url: string
  /** The title the call stated for itself (its `title`, else the file's name), or null. */
  title: string | null
}

const cache = new WeakMap<readonly NativeChatMessage[], readonly SessionArtifact[]>()

/**
 * The pages a conversation's Artifact calls published, in the order first made, each artifact
 * once. A republish of the same page (the same uuid) keeps the first one's place and takes the
 * newer call's link and title, as the page itself now carries them. A quickstart, a list, a read,
 * a failed call or one still running publishes nothing (`artifactCallView` is not `published`).
 */
export function sessionArtifacts(messages: readonly NativeChatMessage[]): readonly SessionArtifact[] {
  const known = cache.get(messages)
  if (known) {
    return known
  }
  const found = new Map<string, SessionArtifact>()
  for (const { call, result } of pairedCalls(messages)) {
    if (!isArtifactToolName(call.name)) {
      continue
    }
    const view = artifactCallView(call, result)
    if (view.kind !== 'published') {
      continue
    }
    const before = found.get(view.link.uuid)
    found.set(view.link.uuid, { uuid: view.link.uuid, url: view.link.url, title: view.title ?? before?.title ?? null })
  }
  const artifacts = [...found.values()]
  cache.set(messages, artifacts)
  return artifacts
}

/** Every tool call with its result: by `callId`, else the next result that names no call (either
 *  side may lack the id, as mobile-native-chat-turn-segments.ts pairs them). */
function pairedCalls(messages: readonly NativeChatMessage[]): { call: NativeChatToolCallBlock; result: NativeChatToolResultBlock | null }[] {
  const byId = new Map<string, NativeChatToolResultBlock>()
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === 'tool-result' && block.callId) {
        byId.set(block.callId, block)
      }
    }
  }
  const pairs: { call: NativeChatToolCallBlock; result: NativeChatToolResultBlock | null }[] = []
  // Calls that named no id, waiting for the next result that names none either.
  const waiting: { call: NativeChatToolCallBlock; result: NativeChatToolResultBlock | null }[] = []
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === 'tool-call') {
        const pair = { call: block, result: block.callId ? (byId.get(block.callId) ?? null) : null }
        pairs.push(pair)
        if (!block.callId) {
          waiting.push(pair)
        }
      } else if (block.type === 'tool-result' && !block.callId) {
        const pair = waiting.shift()
        if (pair) {
          pair.result = block
        }
      }
    }
  }
  return pairs
}

/** What a session artifact's row is called: the account list's title for it (the page's own
 *  `<title>`, which the call never states), else the call's, else "Artifact". */
export function sessionArtifactTitle(artifact: SessionArtifact, accountItems: readonly ClaudeArtifactListItem[]): string {
  const listed = accountItems.find((item) => item.uuid === artifact.uuid)?.title
  return listed || artifact.title || 'Artifact'
}

/** The words on the session bar's button, as the app reads it (`%d artifact(s)`). The button is
 *  not drawn for a session with none. */
export function sessionArtifactsPillLabel(sessionCount: number): string {
  return sessionCount === 1 ? '1 artifact' : `${sessionCount} artifacts`
}

/** The subtitle of a session row, the Claude app's (ds8.java:169). */
export const SESSION_ARTIFACT_SUBTITLE = 'Artifact · claude.ai'

export type ArtifactSheetRow = { uuid: string; url: string; title: string; subtitle: string }

/**
 * The sheet's rows: the session's pages, newest made first (the page just made is the one most
 * likely wanted), each titled from the account's list when it is there.
 */
export function sessionArtifactRows(session: readonly SessionArtifact[], accountItems: readonly ClaudeArtifactListItem[]): ArtifactSheetRow[] {
  // Walked from the end rather than `toReversed()`, which Hermes does not promise (its sibling
  // `toSorted` is already banned here, hermes-array-sorting-compat.test.ts).
  return session
    .map((_, index) => session[session.length - 1 - index]!)
    .map((artifact) => ({
      uuid: artifact.uuid,
      url: artifact.url,
      title: sessionArtifactTitle(artifact, accountItems),
      subtitle: SESSION_ARTIFACT_SUBTITLE
    }))
}
