# Background tasks pill and sheet (chat mode)

Shows Claude Code's background shells and subagents under the newest message
("N running tasks") with a sheet of Running and Finished rows. Code UI cannot
stop a Claude task, so rows carry no stop control.

## Sources, in order of authority

1. **The transcript** (`mobile/src/session/mobile-background-tasks.ts`).
   A `Bash` call whose result says `Command running in background with ID: …`
   (or `moved to the background (ID: …)`) and an `Agent` call whose result
   carries `agentId: …` are launches. A user-role `<task-notification>` turn
   naming the id retires the task, with `<status>failed` shown as a failure.
   Tool calls pair with results FIFO by ordinal, the rule
   `pairToolBlocks` uses, and an interrupted turn drops its unanswered calls.
2. **The host's hook status** (`agentStatus` on the session tab, from Orca's
   hook listener). This is what fixes the case the transcript cannot see:
   - A completion that lands **mid-turn** is never written as a user turn.
     Claude Code 2.1.266 stores it as an `attachment` record of type
     `queued_command`, which Orca's transcript reader does not surface.
     Observed 2026-09-09 on the S23: five tasks shown running while two were.
   - `agentStatus.subagents` is the live roster kept current by
     SubagentStart/SubagentStop and Claude's `background_tasks` inventory. When
     the host reports status at all, a launched agent absent from the roster
     (or idle in it) is finished. Absent field = none tracked, which is how
     Orca's own sidebar reads it. Roster entries the loaded transcript window
     never showed are listed as running.
   - Orca holds the pane `working` while Claude's Stop hook still lists a
     running non-agent task, so `state: 'done'` means every background shell
     has reported. A shell with no notification while the pane is still
     `working` stays listed; the host gives no per-shell ids, so this is the
     remaining approximation.
   - `null` status (no hooks for this pane, an older host) trusts the
     transcript alone.

## Tests

`mobile-background-tasks.test.ts`: transcript derivation against verbatim
transcript bytes, plus "background tasks reconciled against the host agent
status" (roster retirement with no notification, absent roster, pane `done`
retiring shells, roster-only agents, idle teammates, null status).
`MobileBackgroundTasksSheet.test.tsx`: rendering in both themes.
