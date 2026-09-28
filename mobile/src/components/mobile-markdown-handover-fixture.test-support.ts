/**
 * Lines 18-68 of HANDOVER.md at the root of the main checkout (written
 * 2026-09-26, not tracked), verbatim: the
 * document the phone drew with its code pills over the lines above them
 * (screenshot, 2026-09-28). One prose run: the Gate item, a `##` heading, a
 * paragraph, the `### 1.` heading with `+93` and `+61`, the Worktree item
 * whose pills wrap after a bold label, and the rest of that section and the
 * next, which is text enough behind them for RN to run out of span
 * priorities (see mobile-markdown-pill-rows.test-support.ts).
 */
export const HANDOVER_2026_09_26_LINES_18_TO_68 = [
  "- **Gate:**",
  "  `cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint && node scripts/check-tests-typecheck-ratchet.mjs`",
  "  The RPC-recording suites (`src/test-support/rpc-recording`) and",
  "  `mirrored-storage-write-path` time out when the Mac is loaded. Rerun them",
  "  alone before calling a failure real.",
  "",
  "## Four pieces of work in progress, one worktree each",
  "",
  "None of these is merged. Each needs its work finished, the full gate, a",
  "review by a regular subagent (see \"Don't\" below), a rebase onto current main,",
  "and a check before merging that no `zz-review-*` scratch file is left.",
  "",
  "### 1. Large-file line count (`+93` where the phone showed `+61`)",
  "",
  "- **Worktree:** `.claude/worktrees/agent-a44e72e208010c6a9`, branch",
  "  `worktree-agent-a44e72e208010c6a9`, 25 commits past main, all committed.",
  "- **What it does:** Orca clips tool input at 4000 characters, so a large",
  "  Claude Write had no full line count on the wire. The phone now reads the",
  "  file from the desktop (`files.read`), but only when the file still starts",
  "  with the uncut prefix and no later call touched it. The user chose this",
  "  approach.",
  "- **Main commit:** ed13af0d.",
  "- **The review of ed13af0d (a906db18) found:**",
  "  1. a background task already running could change the file unseen;",
  "  2. `!`/`<bash-input>` commands were invisible;",
  "  3. `~/` paths weren't matched;",
  "  4. a docs line wrongly said \"once per connection\";",
  "  5. read-only verbs (`chmod`, `cat`, running the file) needlessly voided the count.",
  "- **The commits after ed13af0d address those,** plus TaskStop, PowerShell,",
  "  `NAME=value` and Windows-home cases found along the way.",
  "- **Stopped while:** checking whether a PowerShell launch is ever read as",
  "  background work.",
  "- **Left to do:** finish, gate, a fresh review, merge.",
  "",
  "### 2. Teammate prompts and records shown as the user's or the lead's",
  "",
  "- **Worktree:** `.claude/worktrees/agent-ab9912a00d262865a`. Its WIP is in",
  "  **698edab8** and is NOT gated.",
  "- **The symptom:** the lead chat showed a user bubble holding an in-process",
  "  teammate's prompt (\"You are a second reviewer…\").",
  "- **What's established:**",
  "  - That text was never a user row in the lead transcript. It most likely",
  "    came through Orca's live `agentStatus.prompt` (UserPromptSubmit).",
  "  - The teammate's own assistant text and tool calls were written INTO the",
  "    lead's transcript. Lead transcript lines ~23690-23691 have the same",
  "    sessionId and cwd, `isSidechain: false`, no agentId and an identical key",
  "    set. The `parentUuid` chain is the likely only signal.",
  "- **New files:** `pane-session-owner.ts`, `pane-session-evidence.ts`, tests.",
  "- **Stopped while:** running a mutation check on the plan-clear and",
  "  reply-clearing rules.",
  "- **Left to do:** finish, gate, review, merge.",
].join('\n')
