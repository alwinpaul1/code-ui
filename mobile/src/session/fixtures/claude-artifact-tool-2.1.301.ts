import type { NativeChatBlock } from '../../../../src/shared/native-chat-types'

// ─── Claude Code's Artifact tool, as a session records it ────────────────────
//
// Claude Code 2.1.301, session 211c47c2 (claudeui) on this machine, 2026-10-16.
// Two real calls, ids and inputs as recorded. Each result's text is cut to its
// first paragraph; the rest is instructions to the model about watching and
// updating the page, which nothing on the phone reads.
//
//   - `action: "quickstart"`: lists Artifact types. Its result NAMES artifact
//     links (each type's `type_url`), so a link in a result is not by itself a
//     published page.
//   - a publish (no `action`, a `file_path`): its result's first line is
//     "Published <path> at <link> (Version 1, version id …) Icon: "…"." The
//     link is `claude.ai/artifact/<id>`, the id being the base58 (bitcoin
//     alphabet) of the artifact's uuid, `3b1a0ad3-2ac6-4209-b219-d64d46bfa3bf`.
//     The transcript's `toolUseResult` also held `title: "Code UI Artifact
//     Check"` and `artifact_id`, but the phone is handed the text alone, which
//     carries no title.

export const QUICKSTART_CALL: NativeChatBlock = {
  type: 'tool-call',
  name: 'Artifact',
  callId: 'toolu_014GZ1diHcpMEQDzuEjeKmzh',
  input: { action: 'quickstart', intent: 'other', design_systems: false }
}

export const QUICKSTART_RESULT: NativeChatBlock = {
  type: 'tool-result',
  callId: 'toolu_014GZ1diHcpMEQDzuEjeKmzh',
  output:
    'Quickstart. This one result stands in for listing the Artifact types — do not make that call as well. For a dashboard, metrics page, KPI tracker or scorecard, start from the Dashboard type: publish with `type_url`: "https://claude.ai/artifact/GZLZthZ2sQjn7T16skfdeF", a `title`, no files and `auto_open: "after_first_write"`, then follow the instructions that result carries. If a listed type fits what the user wants, start from it: publish with its `type_url`, a `title`, no files and `auto_open: "after_first_write"`, then follow the instructions that result carries. Otherwise make a plain page.'
}

export const PUBLISHED_FILE_PATH =
  '/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/211c47c2-7a42-4c86-9a59-eaa0905d39e6/scratchpad/artifact-fixture/code-ui-artifact-check.html'
export const PUBLISHED_LINK = 'https://claude.ai/artifact/8JHvPGXwg2SLbchagvbYU6'
export const PUBLISHED_UUID = '3b1a0ad3-2ac6-4209-b219-d64d46bfa3bf'
/** The page's own `<title>`, which the account's artifact list states (probe P17, 2026-10-16). */
export const PUBLISHED_TITLE = 'Code UI Artifact Check'

export const PUBLISH_CALL: NativeChatBlock = {
  type: 'tool-call',
  name: 'Artifact',
  callId: 'toolu_012rzUnhprp5guy764BGhevT',
  input: {
    file_path: PUBLISHED_FILE_PATH,
    icon: 'checklist',
    description: "A small test page for Code UI's artifact card, viewer and session list."
  }
}

export const PUBLISH_RESULT: NativeChatBlock = {
  type: 'tool-result',
  callId: 'toolu_012rzUnhprp5guy764BGhevT',
  output: `Published ${PUBLISHED_FILE_PATH} at ${PUBLISHED_LINK} (Version 1, version id 1792152562-dcc0) Icon: "checklist".`
}
