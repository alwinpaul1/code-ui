# Native chat: a message glued onto its own residue (2026-09-09)

Seen on the S23 in chat mode against Claude Code 2.1.266. The user sent one
message; the transcript received it once, prefixed by most of itself:

```
 review my paper … each agent use /unslop Ok now review my paper … /unslop skill to write
```

The clean bubble above it in the chat was the phone's optimistic echo, which
never retired because the text Claude recorded was different.

## Cause

1. The draft mirror types the composer text onto the agent's input line as the
   user types, so the desktop shows the message before it is sent. A message of
   this length wraps to four visual lines on the phone-sized terminal.
2. Before typing the body, the send path cleared the line with **one Ctrl+U**
   (its own write). In Claude Code 2.1.266, Ctrl+U deletes to the start of the
   current **visual** line, not the logical line. Measured in a 60-column tmux
   pane: on the four-line message it removed only ` skill to write`.
3. The body was then typed after the surviving three lines and submitted.
   The trailing space at the wrap point is the space in `/unslop Ok now`.

The parked-launch-draft and queue-residue paths already used the shared
multi-line burst (`buildAgentTuiClearInputForText`), but that counts logical
lines, so a long single-line draft got the same one Ctrl+U.

Also measured while here: a bracketed paste whose payload starts with DEL bytes
drops the DELs and inserts the text. Not the cause of this report, but it rules
out ever bundling erase bytes into a paste.

## Fix

`mobile/src/session/mobile-native-chat-input-clear.ts` sizes the burst by
**visual** lines, counting each logical line at the narrowest terminal the phone
will measure (20 columns) plus the shared slack, and takes the tallest of every
text the phone believes is on the line: the parked launch draft, the queue
residue and the draft itself. A 17× Ctrl+U + 17× Ctrl+K burst emptied a
six-visual-line input in one write. Overshoot is free (see the shared module).

Used by the text send and by the image-attachment paste, which had the same one
Ctrl+U default in front of the caption. The stale-paste heal keeps its single
Ctrl+U: it runs before the send's own burst.

## Tests

- `mobile-native-chat-input-clear.test.ts` — clears every visual line of a long
  single-line draft; never a single Ctrl+U; caps the burst.
- `use-mobile-native-chat-message-send.test.ts` — "clears every wrapped line of
  the mirrored draft, not just the last one" (failed before: the clear was `\x15`).
- `use-mobile-native-chat-image-attachments.test.ts` — the paste's leading clear
  is sized to the caption.

Not verified on the phone yet; the burst was verified against Claude Code
2.1.266 directly. Codex was measured clean with the same burst earlier (shared
module comment).
