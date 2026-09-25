/**
 * A search snippet cut into plain and matched runs.
 *
 * The host marks each match with doubled brackets (`[[term]]`, SESSION_SEARCH_SNIPPET_MARK_OPEN and
 * _CLOSE in Orca's session-search-engine-types.ts), doubled because single brackets are everywhere in
 * code transcripts. This mirrors the desktop's `highlightedSearchSnippet`
 * (AiVaultSearchEvidence.tsx): a non-greedy match per marker pair, the text between pairs kept as
 * it is, and an unpaired `[[` left as literal text rather than swallowing the rest of the snippet.
 */
export type SearchSnippetRun = { text: string; match: boolean }

const MATCH_MARKER = /\[\[([\s\S]*?)\]\]/g

export function searchSnippetRuns(snippet: string): SearchSnippetRun[] {
  const runs: SearchSnippetRun[] = []
  let offset = 0
  for (const found of snippet.matchAll(MATCH_MARKER)) {
    const index = found.index
    if (index > offset) {
      runs.push({ text: snippet.slice(offset, index), match: false })
    }
    // An empty pair (`[[]]`) marks nothing, so it draws nothing rather than an empty highlight.
    if (found[1]) {
      runs.push({ text: found[1], match: true })
    }
    offset = index + found[0].length
  }
  if (offset < snippet.length) {
    runs.push({ text: snippet.slice(offset), match: false })
  }
  return runs
}

/** The desktop's role labels for the turn a snippet came from (conversationRoleLabel). */
export function searchEvidenceRoleLabel(role: string): string {
  switch (role) {
    case 'user':
      return 'You'
    case 'assistant':
      return 'Agent'
    case 'tool':
      return 'Tool'
    case 'system':
      return 'System'
    default:
      return 'Session'
  }
}
