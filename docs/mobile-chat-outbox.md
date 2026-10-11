# Chat outbox: how a message the phone could not confirm still gets sent

The user, 2026-10-11, on 0.9.128: "A text message that times out while you're in another chat is
sent once when you come back. All messages must be send reliability and must not drop".

## What was there before

- Every composer send is written to a durable outbox (`mobile/src/storage/native-chat-outbox.ts`)
  before the box empties, and retired once its fate is known
  (`mobile/src/session/native-chat-outbox-sends.ts`).
- A send whose acknowledgement was lost is held for 20 s of foreground time
  (`UNCONFIRMED_SEND_DEADLINE_MS`, `mobile-native-chat-unconfirmed-hold.ts`).
- When the hold ran out, only the chat's own recovery (`use-native-chat-outbox-recovery.ts`)
  could send the message again, and only while that chat was on screen with a settled
  transcript. A text whose hold ran out in another chat waited for the user to come back. A photo
  said "Delivery unconfirmed" and left the outbox; after a restart its words went back into the
  composer with "Attach the files again".

## What it is now

An app-wide drainer (`native-chat-outbox-drainer.ts`), mounted once at the root of the app
(`NativeChatOutboxDrainer.tsx` in `app/_layout.tsx`), sends every chat's waiting entries as soon
as the host's link is up, whichever route, chat or tab is on screen.

It runs:

- once the stored outbox is read at app start;
- whenever the outbox changes, or a send hands an entry over (`releaseOutboxSend`: a hold ran out,
  or the chat closed under a held send);
- on every new connection to a host with messages waiting (`useLastConnectedAt`), and every
  return of the app to the front, each starting every entry's backoff over;
- on a timer while an entry waits out its backoff: 2 s, 5 s, 15 s, 30 s, then every 60 s
  (`OUTBOX_DRAIN_BACKOFF_MS`).

It uses the UI's live client for the host, or the background watcher's, and dials nothing of its
own: with no link up, entries wait for the next connection, and the drainer looks again every
30 s (`OUTBOX_DRAIN_NO_LINK_RECHECK_MS`) for a link nothing announced.

Each entry carries what it needs to be sent with no chat on screen, stamped when it is written:
its route (host, worktree, tab, lane, agent, session, terminal, transcript path; published by the
chat controller through `publishOutboxChatRoute`) and, for photos and files, the desktop paths
they were uploaded to with their previews. Entries written by 0.9.128 and earlier have neither:
those still wait for their chat, as before.

### Who sends what

- A text entry whose chat is on screen with a settled transcript: that chat's recovery, as
  before (it reads the chat's own screen state and sends through the composer path).
- Every other entry, and every photo entry: the drainer.
- Each automatic send claims the entry for its length (`claimOutboxSend`), so the two never carry
  one entry at once. Messages of one chat go in the order they were sent, in both: the oldest
  entry still on its way (carried by a send, a photo the drainer holds, or waiting for a safe
  moment) holds the ones after it. A failed entry (waiting for Retry) holds nothing back.

### Never posted twice

- **Structured session:** every attempt carries the entry's one operation id, so the host's
  ledger answers a repeat with the first attempt's result instead of posting it again. The drainer
  holds the session, reads its fence from one snapshot of its feed, sends, and releases it
  (`sendSessionOutboxEntry`). It gives up after `OUTBOX_DRAIN_SESSION_ATTEMPTS` (8) tries.
- **Terminal:** there is no id, so typing again is posting again. The drainer types only on
  evidence that the message did not arrive, read from the desktop (`observeTerminalOutboxEntry`):
  1. the worktree's tab list (`session.tabs.list`): the tab is still there (a tab missing from
     the list counts as closed only after `OUTBOX_TAB_GONE_CONFIRM_MS`, 2 min, of readings: a
     desktop Orca that just restarted lists none), it still runs the session the message was
     written for (only the tab's own agent naming another session counts; a nested agent's status
     does not), its last hook prompt did not change to the message's words since it left (the
     prompt at the press is stamped on the entry as `route.promptBefore`; no time stamp is used,
     since `updatedAt` is restamped by every tool ping and reconnect), and the agent is not
     working, blocked or waiting;
  2. the session's transcript (one `nativeChat.subscribe` snapshot of 200 rows): no row of it
     after the boundary it left at, and for a photo no row naming a desktop path it pasted;
  3. the screen (`terminal.read`): no dialog, the agent's own input box, nothing typed in it at
     the desk (its own words left by an earlier try do not count: the send's clear takes them),
     and a queue box it can read that does not hold the message (one that does counts as
     delivered: it goes when the turn ends). It looks at the desk's input once more after it takes
     the terminal's write lock, right before it types.

  Any read that fails or times out is "not now", never "not there". It looks only
  `OUTBOX_TERMINAL_CONFIRM_WAIT_MS` (20 s) after the last send started, so a row that lands a
  moment late is never typed twice; the chat's own recovery honours the same wait, so a message
  the drainer just typed is neither called "Not sent" nor typed again by a Retry inside it. A chat
  on screen whose composer holds words is never typed into (its live-input mirror shares the
  line). A refusal before anything was typed (a dialog, the terminal busy with another input,
  words at the desk, a session that could not be held) costs no attempt; one after something may
  have been typed does. After `OUTBOX_DRAIN_TERMINAL_ATTEMPTS` (3) typed tries it gives up. A transcript that cannot show whether it arrived (its boundary is not in the read)
  is never typed again by itself.

  The reads were written against Claude Code 2.1.296 screens captured at 46 columns
  (2026-10-09, shared with `send-exit-outbox-terminal.test.ts`). Codex goes through the same
  reads with its own composer and queue readers. An agent whose queue box the phone cannot read
  is never typed into by the drainer: its entries wait for their chat.

### When it gives up

The entry stays in the outbox, marked failed with a reason (`failedReason`), and nothing is said
in a chat that is not on screen. When its chat is next shown, a text says "Not sent" with Retry
and Edit; a photo's words go back into the composer with "it could not be delivered to your
desktop. Attach the files again and send it"; one over a day old, or whose tab moved to another
session, goes back with the reason it always had. Retry is a new press (a new operation id) and
wakes the drainer at once.

### What it writes to the connection log

At most two lines per entry under `chat-outbox`: "Message sent from the outbox" or "Message from
the outbox had arrived" when the drainer settles one, and "Message not sent: it waits in its chat
for Retry" when it gives one up. Never one per try: a line per send pushed the connection events
out of the 200-line log before (0.9.127). Never the words: lengths, counts, the lane and the tab.

## Limits, stated plainly

- A message the agent took from its queue mid-turn writes no transcript row; the drainer finds it
  only through the tab's last hook prompt changing to its words. If another prompt came after it,
  or it repeats the prompt the tab already had ("continue" twice), that evidence is gone, and a
  terminal entry could be typed again. The drainer does not type while the agent works, which
  narrows this to a message taken in the turn that just ended.
- The drainer's clear takes words left on the desk's input line only when they are the message's
  own; a desk user who starts typing in the instant between its last look and its clear can still
  lose those keystrokes. While it types (a few seconds) the phone's own composer send to that tab
  is refused with "Another input is still being sent".
- With no link to the host at all (no screen of it open and no background watcher), entries wait
  for the next connection; the drainer does not dial.
- A structured host that keeps answering "unknown" for an operation id ends, after 8 tries, in
  "Not sent"; a Retry then is a new id and could post a second copy if the first did arrive.
- An entry still in the outbox a week after it was written is dropped when the store is read.
- A failed photo entry offers no Retry bubble of its own: its words come back with the notice.
