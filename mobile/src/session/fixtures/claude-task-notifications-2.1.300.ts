// Real `<task-notification>` user records from this machine's Claude Code transcripts
// (~/.claude/projects, 2.1.29x to 2.1.300, read 2026-10-15). Each is the record's
// `message.content` (the long `<note>` and goal reminder cut short, nothing else changed); every record also carries `origin: {kind: "task-notification"}`.
// The first is the one in the 0.9.146 screenshot (session dcc6f35c, uuid not kept): the agent
// took it mid-turn, so the transcript holds it only as a `queued_command` attachment with the same text.

/** A background command that failed (exit code 144). */
export const FAILED_BACKGROUND_COMMAND =
  '<task-notification>\n<task-id>bi22l2034</task-id>\n<tool-use-id>toolu_012a1vABiDXTT7Ft5z1vHWPs</tool-use-id>\n<output-file>/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/dcc6f35c-7133-438c-99e6-70379aa94d8b/tasks/bi22l2034.output</output-file>\n<status>failed</status>\n<summary>Background command "Reconnect adb then install the universal APK" failed with exit code 144</summary>\n</task-notification>'

/** A background command that finished (session dcc6f35c, uuid 83d20d49). */
export const COMPLETED_BACKGROUND_COMMAND =
  '<task-notification>\n<task-id>bysfnesw0</task-id>\n<tool-use-id>toolu_013xncBK6RCRfUPGft9rFmyi</tool-use-id>\n<output-file>/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/dcc6f35c-7133-438c-99e6-70379aa94d8b/tasks/bysfnesw0.output</output-file>\n<status>completed</status>\n<summary>Background command "Check whether any hostname resolves after the DNS change" completed (exit code 0)</summary>\n</task-notification>'

/** A subagent that finished: `<note>`, `<result>`, `<usage>` and `<worktree>` ride along (uuid 41b93fd2). */
export const COMPLETED_AGENT =
  '<task-notification>\n<task-id>a3828248b8bf217fd</task-id>\n<tool-use-id>toolu_01E6nHTRB5SkHgo3yArQLVqt</tool-use-id>\n<output-file>/private/tmp/claude-501/-Users-alwinpaul-Desktop-NexDash-NexOS/6bfef54c-10f5-46ab-8070-880c73724b7d/tasks/a3828248b8bf217fd.output</output-file>\n<status>completed</status>\n<summary>Agent "Frontend ADR planner UI" finished</summary>\n<note>A task-notification fires each time this agent stops with no live background children of its own. The user can send it another message and resume it, so the same task-id may notify more than once.</note>\n<result>This agent\'s report was delivered to you as a message from "a3828248b8bf217fd" (its SubagentHandback call). Read it there; it is not repeated here.\n</result>\n<usage><subagent_tokens>189558</subagent_tokens><tool_uses>82</tool_uses><duration_ms>687553</duration_ms></usage>\n<worktree><worktreePath>/Users/alwinpaul/Desktop/NexDash/NexOS/.claude/worktrees/agent-a3828248b8bf217fd</worktreePath><worktreeBranch>worktree-agent-a3828248b8bf217fd</worktreeBranch></worktree>\n</task-notification>'

/** A command the system stopped for memory (uuid d6d92744): `killed`, and its own note says it is not a failure. */
export const KILLED_BACKGROUND_COMMAND =
  '<task-notification>\n<task-id>bdfvlqn3r</task-id>\n<tool-use-id>toolu_01CoB52acQ3yYGFRoEK76s7S</tool-use-id>\n<output-file>/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Thesis/dd810065-481d-48c1-aff4-7a270bae794b/tasks/bdfvlqn3r.output</output-file>\n<status>killed</status>\n<summary>Background command "Back up willi scratch (minus datasets and venvs) to AlDrive" was stopped because the system is running low on memory</summary>\n<note>This is not a failure of the command. Claude Code stopped it because the system was critically low on memory while the session was idle, which says nothing about the command or its own memory use, so there is nothing in it to debug.</note>\n</task-notification>'

/** The goal check-in: a summary only, with a `<system-reminder>` after it in the same record (uuid 51c337ec). */
export const GOAL_CHECK_IN =
  '<task-notification>\n<summary>Goal check-in: background work still running</summary>\n</task-notification>\n<system-reminder>\nGoal check-in: «hunt for bugs» is still active, and evaluation has been deferred for 60 min because background work is still running:\n- tl344hpkg · teammate · Fix two defects in Walletify, a personal finance a...\nCheck on their progress (e.g. read their output). If they are progressing, say so briefly and keep waiting; if they are stuck or no longer needed, fix or stop them and continue toward the goal.\n</system-reminder>'
