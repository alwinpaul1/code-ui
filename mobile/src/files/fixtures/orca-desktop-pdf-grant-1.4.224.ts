// Captured 2026-10-15 from the user's own Orca 1.4.224 (local runtime, Claude
// Code 2.1.300 sessions) with read-only `files.resolveTerminalPath` calls made
// through Orca's CLI client, with the exact params the phone sends. Ids and
// paths are verbatim; the one grant id is replaced, since a grant is bound to
// the client that asked for it.
//
// Project "main" (worktree ~/Desktop/Project/Thesis) had two Claude tabs, TACO
// and JETCAS, and a file tab the desktop user opened on a PDF in ~/Downloads.
// The TACO session's assistant text names that PDF 10 times, always spelled
// `~/Downloads/BLADE_TACO_final_2026-10-10.pdf` and never as the absolute path.
// Orca matches the transcript against the request's `pathText` and against the
// path it expands that to, so the absolute spelling finds nothing and the tilde
// spelling finds the session's own words.

export const THESIS_WORKTREE_ID =
  '10e21f69-ad82-4743-8c4b-b938873247d6::/Users/alwinpaul/Desktop/Project/Thesis'
export const PDF_ABSOLUTE_PATH = '/Users/alwinpaul/Downloads/BLADE_TACO_final_2026-10-10.pdf'
/** How the TACO session's assistant text spells the path, every time it names it. */
export const PDF_AS_THE_SESSION_WROTE_IT = '~/Downloads/BLADE_TACO_final_2026-10-10.pdf'
export const HOST_HOME = '/Users/alwinpaul'
export const GRANT_ID = 'grant-from-taco-transcript'

/** `session.tabs.list` for the worktree, trimmed to the fields the phone reads. */
export const THESIS_SESSION_TABS = [
  {
    type: 'terminal',
    id: 'dab2407f-458c-402f-ab39-274f4306a856::b962137e-8db4-4449-bb21-e62f78644cd0',
    title: '✳ TACO',
    status: 'ready',
    isActive: false,
    agentStatus: {
      agentType: 'claude',
      state: 'done',
      providerSession: {
        key: 'session_id',
        id: '36279b15-23eb-49ee-aa03-67b6555076bd',
        transcriptPath:
          '/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Thesis/36279b15-23eb-49ee-aa03-67b6555076bd.jsonl'
      }
    }
  },
  {
    type: 'terminal',
    id: 'dab2407f-458c-402f-ab39-274f4306a856::6bd3fa8a-cff2-4bd8-8fc2-74e11fdb3358',
    title: '✳ JETCAS',
    status: 'ready',
    isActive: false,
    agentStatus: {
      agentType: 'claude',
      state: 'done',
      providerSession: {
        key: 'session_id',
        id: '7243984f-4805-4d35-bfeb-8ef47d4eb953',
        transcriptPath:
          '/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Thesis/7243984f-4805-4d35-bfeb-8ef47d4eb953.jsonl'
      }
    }
  },
  {
    type: 'file',
    id: '09009e14-3e15-4908-b560-3abe9fa5ddf4',
    title: 'BLADE_TACO_final_2026-10-10.pdf',
    relativePath: PDF_ABSOLUTE_PATH,
    filePath: PDF_ABSOLUTE_PATH,
    isActive: true
  }
] as const

export const TACO_TAB_ID = THESIS_SESSION_TABS[0].id
export const TACO_SESSION_ID = THESIS_SESSION_TABS[0].agentStatus.providerSession.id
export const JETCAS_TAB_ID = THESIS_SESSION_TABS[1].id
export const JETCAS_SESSION_ID = THESIS_SESSION_TABS[1].agentStatus.providerSession.id

/** Orca's answer when nothing vouches for the path: the file exists, Orca says it does not. */
const NOT_VOUCHED = {
  worktree: THESIS_WORKTREE_ID,
  relativePath: null,
  absolutePath: PDF_ABSOLUTE_PATH,
  exists: false,
  isDirectory: false
}

/**
 * Each captured `files.resolveTerminalPath` reply, keyed by the request's
 * `pathText` and the tab id of its `nativeChatContext` (`-` for none). Every
 * request carried `crossWorkspace: true` and `worktree: id:<THESIS_WORKTREE_ID>`.
 */
export const RESOLVE_REPLIES: Record<string, unknown> = {
  // What 0.9.152 sends: the absolute path, with and without TACO's context.
  [`${PDF_ABSOLUTE_PATH} ${TACO_TAB_ID}`]: NOT_VOUCHED,
  [`${PDF_ABSOLUTE_PATH} -`]: NOT_VOUCHED,
  [`${PDF_ABSOLUTE_PATH} ${JETCAS_TAB_ID}`]: NOT_VOUCHED,
  // Where `~/` lands on this host: the expansion, no stat, no grant.
  ['~/ -']: {
    worktree: THESIS_WORKTREE_ID,
    relativePath: null,
    absolutePath: HOST_HOME,
    exists: false,
    isDirectory: false
  },
  // The session's own spelling with TACO's context: a read-only grant.
  [`${PDF_AS_THE_SESSION_WROTE_IT} ${TACO_TAB_ID}`]: {
    worktree: THESIS_WORKTREE_ID,
    relativePath: null,
    absolutePath: PDF_ABSOLUTE_PATH,
    exists: true,
    isDirectory: false,
    openTarget: {
      kind: 'absolute-file',
      provider: 'local',
      absolutePath: PDF_ABSOLUTE_PATH,
      grantId: GRANT_ID,
      readOnly: true
    }
  },
  // JETCAS never wrote the path in its assistant text: no grant.
  [`${PDF_AS_THE_SESSION_WROTE_IT} ${JETCAS_TAB_ID}`]: NOT_VOUCHED
}

/** `files.readTerminalArtifactPreview` with that grant: keys and flags as captured (content shortened). */
export const GRANTED_PREVIEW = {
  content: 'JVBERi0xLjQKJcfsj6IKMSAwIG9iago8PC9UeXBlL0NhdGFsb2c+PgplbmRvYmoKdHJhaWxlcgo8PC9Sb290IDEgMCBSPj4KJSVFT0YK',
  isBinary: true,
  isImage: true,
  mimeType: 'application/pdf'
}
