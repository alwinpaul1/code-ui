# Code UI's own files inside src/shared

`src/shared/` is vendored Orca code: re-vendor it, never edit it here. These files
are the exceptions — Code UI authored them and they have no upstream counterpart at
any commit. A re-vendor must not delete them and must not be surprised by them.

- `native-chat-pasted-image-paths.ts` — imported by `native-chat-image-transcript-markers.ts`
  and by three files under `mobile/src/session/`. It belongs in `mobile/src/session/`;
  moving it also edits the vendored importer, so that is its own commit, not a
  side effect of a port.

Everything else under `src/shared/` came from upstream. When a file is re-vendored
past the base commit in `UPSTREAM.txt`, record its own commit there.

## Vendored files carrying a local hunk

These came from upstream and were then edited here. A re-vendor must
re-apply the hunk, not drop it. Both fix behaviour upstream does not have.

- `native-chat-session-option-snapshot.ts` — an unlisted tracked model (a
  release newer than the catalog) keeps the catalog's fallback effort rows,
  so the sheet is not model-name-only.
- `native-chat-session-option-state.ts` — when the agent reports a different
  model than the one the user picked, the user's own non-reported picks are
  carried onto the reported model instead of being dropped.
- `native-chat-slash-commands.ts` (and its test) — Code UI enumerated Claude
  Code 2.1.261's and Codex 0.153.4's real command tables in place of upstream's
  five-entry catalogs, and added `opensOverlay`, `isSlashCommandToken` and
  `slashCommandOpensOverlay`. Upstream has none of it. A whole-file re-vendor
  would delete the catalogs the `/` menu is built from.

## Vendored files carrying a hand-applied upstream hunk

Not a clean copy of any upstream commit: an upstream change was applied by hand
because the file had diverged, or because the surrounding upstream commit is not
vendored here. Re-vendoring one of these at a later commit is fine and drops the
entry; re-vendoring it at an EARLIER one silently reverts the hunk.

- `structured-agent-session-reducer.ts`, `structured-agent-session-coalescer.ts`
  — the per-session `/` command catalog from bf4e27050. These files otherwise
  sit at the base commit: #19147's `backgroundTasks`/`activity` handling and its
  journal-unchanged short-circuit are NOT vendored, so the reducer's own
  identity-preservation behaviour differs from upstream's.
- `native-chat-slash-commands.ts` — `sessionSlashCommandSuggestions` and
  `sessionReportedSkillNames` from bf4e27050, on top of the local catalogs above.
- `protocol-version.ts` — `STRUCTURED_AGENT_SESSION_RESUME_HISTORY_RUNTIME_CAPABILITY`
  from 1ae7aa8bb. The file otherwise sits at its d07c47593 pin: upstream later added
  `NOTIFICATIONS_REMOTE_PUSH_RUNTIME_CAPABILITY` and
  `NOTIFICATION_DELIVERY_PREFERENCES_CAPABILITY`, which are NOT vendored here, so a
  whole-file re-vendor would drag in an unported change.

