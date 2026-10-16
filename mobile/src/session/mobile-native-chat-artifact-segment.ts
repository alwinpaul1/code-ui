import {
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatBlock,
  type NativeChatToolCallBlock
} from '../../../src/shared/native-chat-types'
import { artifactCallView, type ArtifactCallView } from './claude-artifacts'

/** Claude Code's tool name for publishing a page to claude.ai (2.1.301). */
export function isArtifactToolName(name: string): boolean {
  return name.trim().toLowerCase() === 'artifact'
}

/** What an Artifact call draws as, given the block after it (its answer, when it is one). `row`
 *  for any other call, so the turn's segments and the segment's renderer read one rule. */
export function artifactCallViewBeside(call: NativeChatToolCallBlock, next: NativeChatBlock | undefined): ArtifactCallView {
  if (!isArtifactToolName(call.name)) {
    return { kind: 'row' }
  }
  const answer =
    next && isToolResultBlock(next) && (call.callId === undefined || next.callId === undefined || call.callId === next.callId)
      ? next
      : null
  return artifactCallView(call, answer)
}

/**
 * The Claude app's card (a18.java:56-190) for a segment that is ONE Artifact call and its answer,
 * as `splitTurnIntoSegments` cuts it; null for every other run, which keeps the ordinary tool row.
 * A quickstart, a list or a read is `row` (artifactCallView), so it is null here and stays in the
 * run beside the work around it.
 */
export function artifactSegmentView(blocks: readonly NativeChatBlock[]): Exclude<ArtifactCallView, { kind: 'row' }> | null {
  const [call, answer, ...rest] = blocks
  if (!call || !isToolCallBlock(call) || rest.length > 0 || (answer !== undefined && !isToolResultBlock(answer))) {
    return null
  }
  const view = artifactCallViewBeside(call, answer)
  return view.kind === 'row' ? null : view
}

/** The card's words and behaviour, as kv30.a builds them (1.261013.20). */
export type ArtifactCardContent = {
  title: string
  /** Under the title, or null for none. */
  subtitle: string | null
  /** A 20 dp spinner in a 32 dp box at the card's end, and no tap. */
  busy: boolean
  /** Whether a tap opens the page. */
  opens: boolean
  accessibilityLabel: string
}

/** The app's `ccr_artifact_card_kind` and `ccr_artifact_card_fallback_title`. */
const KIND = 'Artifact'
const STATES = { publishing: 'Publishing…', opening: 'Opening…' } as const

/**
 * What a card says. The title is the account list's for a published page (the page's own
 * `<title>`, which the tool's text result never carries), else the call's own (its `title`, else
 * the file's name), else "Artifact". The subtitle joins "Artifact" and the state with " · ", but
 * kv30.a drops the "Artifact" when there is no title (`if (str == null) strQ = null`), since the
 * title then already says it: a titled publish reads "Artifact · Publishing…", an untitled one
 * "Publishing…", and a published page with no title has no subtitle at all.
 */
export function artifactCardContent(
  view: Exclude<ArtifactCallView, { kind: 'row' } | { kind: 'failed' }>,
  listTitle: string | null
): ArtifactCardContent {
  const own = (view.kind === 'published' ? listTitle?.trim() || view.title?.trim() : view.title?.trim()) || null
  const title = own ?? KIND
  switch (view.kind) {
    case 'publishing':
    case 'opening': {
      const state = STATES[view.kind]
      return { title, subtitle: own ? `${KIND} · ${state}` : state, busy: true, opens: false, accessibilityLabel: `${title}, ${state}` }
    }
    case 'published':
      return { title, subtitle: own ? KIND : null, busy: false, opens: true, accessibilityLabel: `Open ${title}` }
    default: {
      const unhandled: never = view
      return unhandled
    }
  }
}
