# The model pill on a Claude session that states no model (2026-09-27)

A Windows host gets no beacon flag (`hostTakesAgentHudFlag` in
`mobile/src/session/agent-hud-launch-args.ts`), and a user with no status line
of their own paints no `[Model effort]` badge. With neither, the phone had no
live pair: the header pill showed nothing and the composer pill read "Model"
(reported 2026-09-27: "On Windows systems they can't read from the statusline,
so it shows just 'model'").

Claude Code's transcript records the answering model on every assistant record
(`message.model`, e.g. `claude-opus-5-5`). That is the agent's own record, not a
guess from a name. This note covers where the phone can and cannot read it,
checked against Orca origin/main 8d6fec597b (2026-09-23).

## What does not carry it

| Path the phone receives | Why the model is not in it |
|---|---|
| `nativeChat.subscribe` / `nativeChat.readSession` (the chat) | `decodeClaudeTranscriptLine` (`src/main/native-chat/transcript-line-decoders-claude.ts:73-131`) builds each `NativeChatMessage` from `id`, `role`, `blocks`, `timestamp` and `source` only. It drops `message.model` and `isSidechain`. `NativeChatMessage` (`src/shared/native-chat-types.ts:186-199` in Orca, 114-129 in the vendored copy) has no model field. The Codex decoder drops `turn_context.model` the same way. |
| `agentStatus.model` on the session tab | No Claude hook provider sets it. `claude-events.ts`, `claude-lifecycle-events.ts`, `claude-status-build.ts` and `claude-roster-state.ts` never mention a model. Only Codex (`codex-events.ts:229-231`), the Pi family and structured sessions (`server-ingest-structured.ts:60`) set it. |
| `accounts.subscribe` | Accounts and rate limits only. |
| Structured `agentSession.*` | Carries the model only for Orca-owned structured sessions. A terminal Claude tab is not one. |

## What carries it, and how the phone uses it

`aiVault.listSessions` is the scan behind the Session History screen. It is on
the mobile allowlist in both Orca 1.4.205 (`orca-mobile-rpc-allowlist-1.4.205.json`)
and origin/main. Each row's `model` is the `message.model` of the LAST assistant
record in that session's own file (`session-scanner-primary-parsers.ts:159-168`).
Subagent transcripts are separate files that this list does not include. Orca
lists them on demand through `listAiVaultSubagentSessionsInBackground`, so a
session's row reads its main file. The phone already received this field on the history screen,
through a loose reader, and read nothing from it.

The call is expensive. Once the host's 60 s cache has lapsed, it scans every
agent's session store on the machine, WSL homes included on Windows. The host
also keeps only one cache slot (`cached-session-list.ts`). So the phone uses it
under a strict budget (`mobile/src/session/claude-transcript-model-scan.ts`,
`use-claude-transcript-model.ts`):

- **When it runs:** only for a Claude chat on the terminal lane that has had no
  beacon and no badge for 8 s.
- **Triggers:** it asks the host when the chat opens (and again on a new
  connection), when the user opens the model sheet, and at the end of the
  first turn that began after the phone itself changed the model. It never
  asks on every turn end.
- **Budget:** at most one attempt per host per five minutes. It sends
  `limit: 20` and the history screen's own workspace `scopePaths`, so the two
  share the host's cache. Every call uses `force: false` except the one that
  confirms a model switch. That call is forced, because an answer the host
  cached before the confirming turn would still name the old model. When the
  budget holds it back, it runs by itself once the five minutes are up, while
  a chat for that host is on screen. An unforced reading counts as fresh only
  from one host-cache minute before it was asked for.
- **Matching:** it reads only the row for this tab's exact session id. It skips
  subagent rows and other agents' rows. It drops `<synthetic>` (the model Claude
  Code records on a reply it wrote itself, such as an API error) and any id that
  is not a Claude id.
- **Display:** only the name ("Opus 5.5"). The transcript records no effort and
  no window size. A Claude id with a family the table does not know shows as
  the raw id.
- **Priority:** the beacon or the badge always wins. After the phone's own
  `/model`, the fallback shows NOTHING. It never shows the pick, which is the
  phone's record and not the agent's word (the "Fable Medium" on an Opus
  session, 2026-09-18). It also does not show the earlier reading, which the
  switch may have replaced. It stays blank until a scan is taken after the
  first turn that began after the pick has ended. Claude Code applies a
  `/model` sent mid-turn only when that turn ends, so that turn's reply is
  still the old model. Once such a scan exists, it shows what answered, whether
  or not the switch took. Both times are the phone's own clock. The composer's
  own snapshot label, drawn when there is no pair at all, is unchanged.
- **Failure:** a refused, timed-out or malformed reply logs one
  `[transcript-model]` line naming the host and the reason. It keeps the last
  good reading (nothing, if there was none). The next new connection asks
  again once, even inside the five minutes (`shouldRefetchAfterReconnect`).
  A single retry runs by itself when the five minutes are up, while a chat for
  that host is on screen.

**Known limits:**

- A reading is only as new as the last scan, and scans run only on the
  triggers above. In a chat left open, it can be as old as the chat. A switch
  made on the desktop shows once the chat reopens or reconnects, or once the
  model sheet opens after the five-minute budget. In each case it can also be
  up to one host-cache minute stale.
- A turn that runs while the chat is closed is not seen ending, so after a pick
  the fallback stays blank until the next turn the chat sees.
- Unverified: the phone's own pick is a `/model` typed into the agent's
  terminal. If Orca reports that command as a working→done cycle of its own,
  the phone takes the cycle for the first turn after the pick. The scan at its
  end would then read the model from before the switch and show it until the
  next scan. The phone's working flag comes from Orca's status for the tab and
  from the transcript's lead-turn end. Whether a local slash command moves
  either has not been observed.
- A legacy transcript that wrote sidechain records inline would feed a
  subagent's model into the parent row. Current Claude Code writes subagents
  to separate files.

## The clean fix, which is Orca's to make

Keep the model on the chat message. In `decodeClaudeTranscriptLine`, for an
assistant record that is not `isSidechain` and whose `message.model` is a
string other than `<synthetic>`, set an optional `model` on the returned
`NativeChatMessage`. Add `model?: string` to `NativeChatMessage` in
`src/shared/native-chat-types.ts`. The field is additive and plain JSON.
`sanitizeMessage` in `src/main/runtime/rpc/methods/native-chat.ts` spreads the
message, so it would reach the phone on `nativeChat.*` with no other change,
and older clients ignore it.

The phone would then read the newest assistant message's `model` from the
chat it already streams, per message and with no scan. The AI Vault path above
could then be deleted.
