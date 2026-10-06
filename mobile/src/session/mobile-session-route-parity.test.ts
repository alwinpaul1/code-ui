import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'
import { MOBILE_SESSION_ROUTE_SOURCE_FILES } from './mobile-session-route-source-family.test-support'

const SESSION_FILES = MOBILE_SESSION_ROUTE_SOURCE_FILES
/** The function the route mounts, which C7.7 moved out of the route file and into a component. */
const ROOT_COMPONENT = 'MobileSessionRouteScreen'
const LOGIC_EXPANSION_NAMES = new Set([
  'useMobileSessionController',
  'useMobileSessionFoundation',
  'useMobileSessionScreenState',
  'useMobileSessionTerminalRuntime',
  'useMobileSessionFeedbackCapabilities',
  'useMobileSessionNativeChatDictation',
  'useMobileSessionTerminalSubscriptionFoundation',
  'useMobileSessionTerminalSubscription',
  'useMobileSessionTerminalStreamDisplay',
  'useMobileSessionTerminalList',
  'useMobileSessionTabApplication',
  'useMobileSessionDocumentReaders',
  'useMobileSessionDiffComments',
  'useMobileSessionMarkdownActions',
  'useMobileSessionTabReconciliation',
  'useMobileSessionLifecycle',
  'useMobileSessionKeyboardState',
  'useMobileSessionStartup',
  'useMobileSessionPreferenceFocus',
  'useMobileSessionTabSwitching',
  'useMobileSessionTerminalWebview',
  'useMobileSessionTerminalSendActions',
  'useMobileSessionFileActions',
  'useMobileSessionTerminalInput',
  'useMobileSessionAccessorySelection',
  'useMobileSessionAttachments',
  'useMobileSessionTerminalCreateActions',
  'useMobileSessionContentCreateActions',
  'useMobileSessionCloseActions',
  'useMobileSessionBulkClose',
  'useMobileSessionPresentation',
  'useMobileSessionPanelRouteActions'
])
const SURFACE_EXPANSION_NAMES = new Set([
  'MobileSessionSurface',
  'MobileSessionHeader',
  'MobileSessionContentRow',
  'MobileSessionActiveContent',
  'MobileSessionCommandDock',
  'MobileSessionSheets'
])
const CONTENT_COMPONENT_NAMES = ['MarkdownReader', 'DiffLineRow', 'FileReader'] as const
const HOST_COMPONENT_NAMES = new Set([
  'ActivityIndicator',
  'Animated.View',
  'FlatList',
  'Image',
  'Pressable',
  'SafeAreaView',
  'ScrollView',
  'Text',
  'TextInput',
  'View'
])

// Pins re-baselined 2026-09-05 for the Code UI fork after the themed session
// chrome (header, dock, accessory strip, active content) landed. Values below
// are the current extraction facts; a future drift here is a real change.
// 278 since 2026-09-18: use-mobile-session-file-actions.ts (inlined into
// SessionScreen's expansion) gained askAboutFileLines, a new useCallback for
// the file reader's "Ask about lines"/"Ask about file".
// 279 since 2026-09-18 (later): the file actions bind "Revert this hunk" for
// the chat's diff cards (useMobileNativeChatHunkRevert), one hook and its
// binding.
// 281 since 2026-09-18 (later still): the same file gained two more —
// resolveAskAboutScreenTarget and askAboutTerminalScreen, the terminal's
// "Ask about this screen" (VS Code 2.1.275's "Send terminal output to
// Claude" parity).
// 282 since 2026-09-19 (upstream #20069): useMobileSessionFoundation binds
// useHostProtocolGates for hostCapabilities, which the create action reads to
// decide whether it may paint a created tab's placement itself.
// 283 since 2026-09-19 (upstream #20545): useTerminalCopyTrimsGutter's
// binding call in use-mobile-session-accessory-selection.ts, mirroring the
// desktop's "Trim Gutter on Copy" setting onto the mobile Copy button. Both
// ports landed the same day on separate branches; re-pinned at the merge.
// 284 since 2026-09-19 (upstream #20601, the native-chat group): the chat
// controller's structuredCancelPrompt, and the tab reconciliation's
// prompt-cancel capability read; re-pinned again at that merge.
// 286 since 2026-09-19 (night): terminalHandlesFor and the outside-worktree prefetch effect (readers).
// 289 since 2026-09-22: chat dictation's caret ref, insert-range ref, and the
// paint state for the open phrase.
// 294 since 2026-09-23 (Orca #21790, C7.2): five clipboard hooks join the
// expanded route, the same +5 upstream measured — a writer in the diff-note,
// Markdown and selection actions, a reader in the selection actions and the
// attachment probe. The hook binding, callback identity and body, effect and
// leaf-JSX pins moved with them, and only those.
// 295 since 2026-09-24: the terminal input's gesture output-window ref, the
// wheel rows each terminal has had since it last printed.
// 2026-09-24: reportDictationFailure (Orca #22256), and useSoftKeyboard with its two
// effects in place of the Keyboard.addListener pair (Orca #22252).
// 301 since 2026-09-25 (Orca #22300): the terminal fields' submit seam — submitLiveInput and
// a useTerminalTextFieldSubmitBinding per field in the send actions, the same +3 upstream
// measured once its submitBufferedDraft stopped being a useCallback. The hook binding, callback
// identity and body, and host-JSX pins moved with them, and only those.
// 302 since 2026-09-25 (Orca #22362): the Markdown actions' useBackClaim, the page's claim on
// Back while a draft is dirty. Upstream's count held because its claim replaced a native
// BackHandler effect; this fork never had that effect, so here it is +1.
// 303 since 2026-09-26: useMobileSessionSaveToPhonePresence in the controller, which tells a
// tab-menu Save to Phone whether the user is still in the session. Not expanded here: its own
// refs, focus effect and memo stay inside it, so the callback, effect and JSX pins held.
// 304 since 2026-09-30: useClipboardWriter in the dictation hook, for desktop dictation that no
// field on screen can take (the live terminal refused it, or the command box is not drawn). The
// hook and binding pins moved, and only those.
// 305 since 2026-10-04 (Orca #24301): the useState for agent-session.repeated-stop.v1 beside the
// prompt-cancel one in the feedback capabilities, which the status probe sets.
// 307 since 2026-10-06 (Orca #24759 ported): the feedback hook's mountedRef (useRef) and its
// effect (useEffect) join the family.
const HEAD_MAIN_HOOK_SHA256 = '090cc40fd4a219699215880baf1f967aa90b41f99e0c877afda4d45c5cfc417a'
// 2026-09-22: the caret and insert-range refs bind into the dictation start.
// 2026-09-24: gestureOutputWindowsRef binds in the terminal input.
// 2026-09-24: reportDictationFailure and softKeyboard bind (Orca #22256, #22252).
// 2026-09-25: bindLiveInputField and bindCommandField bind (Orca #22300).
// 2026-09-25: hasDirtyDraft binds for the Markdown actions' page Back claim (Orca #22362).
// 2026-09-25 (later): the file actions also take fileTapMatchPicker out of
// useMobileFileTapHandlers, the drawer for a bare chat name found in several folders.
// 2026-09-26: the file actions' Object.assign also takes saveToPhonePresence.
// 2026-09-30: clipboard binds in the dictation hook (useClipboardWriter).
// 2026-10-04: agentSessionRepeatedStopSupported and its setter bind (Orca #24301).
const HEAD_HOOK_BINDING_SHA256 = '43e1a34ae749466e370fd4aa37a730e337427be6022ae23ce95607daca520f05'
// 79 since 2026-09-18: askAboutFileLines, same change as HEAD_MAIN_HOOK_SHA256 above.
// 81 since 2026-09-18 (later): resolveAskAboutScreenTarget and askAboutTerminalScreen.
// 83 since 2026-09-24: reportDictationFailure (Orca #22256).
// 84 since 2026-09-25: submitLiveInput (Orca #22300).
const HEAD_CALLBACK_IDENTITY_SHA256 =
  '7ee5572db983d42e91c565cfcb5650faeef08d166f0b1dacabf408f9fbbc58fe'
// 2026-09-09: the terminal subscription strips the agents' HUD beacon out of
// each output chunk before anything else looks at it, and the create action
// asks for the launch flags that make the agents send one.
// 2026-09-10: split-sibling Close repeats terminal.close so the leftover
// desktop pane collapses after the extra PTY dies.
// 2026-09-11: wheel batches pipeline up to TERMINAL_GESTURE_INPUT_MAX_IN_FLIGHT
// unanswered sends instead of pacing one per relay round trip.
// 2026-09-11 (later): a burst of wheel rows is paced out one per 16 ms flush
// instead of sent as one batch, and nothing is dropped past a token bucket.
// 2026-09-11 (later still): each terminal pill carries an activity badge from
// the host's pushed status — a dot while the turn runs, a shell count after.
// 2026-09-11 (evening): the pill badge became the desktop's own state icons
// (AgentStateDot), on a minute clock for the 30-min staleness decay.
// 2026-09-11 (council fixes): the gesture token bucket is gone, a tap's click
// is sent at once instead of paced, and the ghostty pane routes taps to file/URL.
// 2026-09-11: hardware back moved from the markdown actions to the view switch,
// where it can return a terminal-mode tab to its chat view before leaving.
// 2026-09-18: askAboutFileLines's own body, same change as above.
// 2026-09-18 (later): resolveAskAboutScreenTarget's and askAboutTerminalScreen's
// bodies, same change as HEAD_MAIN_HOOK_SHA256 above.
// 2026-09-18 (evening): subscribeToTerminal and unsubscribeTerminal stamp when
// the phone starts and stops listening on a handle (noteAgentHudBeaconListening),
// which is what the HUD measures a beacon's silence from.
// 2026-09-19: applySessionTabs and the terminal-list refresh drop the phone's
// own transcript-tail terminal (withoutTranscriptTailTerminals, by title and by
// owned handle) before use, and the refresh closes a tail terminal this
// process does not own, plus any an earlier process recorded and left.
// 2026-09-19 (Orca #20891 ported): body text, not behaviour. Five callbacks
// send through declared operations instead of client.sendRequest — the
// terminal-list refresh, the markdown tab read and save, and the diff-comment
// load and persist — and the refusal try/catch in the diff-comment persist is
// an interpretOrThrowRefusalMessage call. Same 81 callbacks, same identities;
// the goldens under mobile/rpc-foundation pin the behaviour and did not move.
// 2026-09-19 (Orca #20915 ported): two more — the live keystroke send
// (sendLiveTerminalInput) and the accessory's connection lookup
// (getActiveWorktreeConnectionId) name terminal.input-send and the new-tab
// repo.list reader. Same 81 callbacks.
// 2026-09-19 (Orca #20954 ported): the diff-comment load's worktree.show
// reader is renamed (sessionWorktreeRecordRead) and the gesture flush
// (flushTerminalGestureInput) names terminal.input-send. Same 81 callbacks.
// 2026-09-19 (Orca #21083 ported): setDisplayMode's send became
// terminalDisplayModeSet; this fork's queued, viewport-measuring shape is
// unchanged and it still returns the accepted verdict the floor release
// retries on. Same 81 callbacks.
// 2026-09-19 (Orca #21089 ported): the reply casts the checked readers made
// unnecessary — the markdown tab doc (readMarkdownTab, saveMarkdownTab) and
// the worktree record's diffComments (loadDiffComments) are typed by their
// schemas now. Same 81 callbacks.
// 2026-09-19 (Orca #21269 ported): the markdown disk fallback's
// `{ content, truncated, byteLength }` cast is retired — the preview reader
// checks the content and salvages the flag, so readMarkdownTab reads
// `fallback.value` directly. Same 81 callbacks.
// 2026-09-19 (perf-group port, #20545): the Copy button's handler now trims
// the agent gutter through stripTerminalSelectionGutter when the mirrored
// desktop setting is on.
// 2026-09-19 (later): the transcript tail is gone — the tab status carries
// the prompts — so both sites now only drop and close a "Code UI · transcript"
// leftover by title (isTranscriptTailLeftover, closeTranscriptTailLeftovers).
// Re-pinned on the group D merge, 2026-09-19: main's hash (32cb4340) carried
// the gutter trim and the leftover close, ours (6f303025) the operation sends
// and the retired casts; the merged tree carries both (the terminal-list
// refresh reads through sessionTerminalListRead AND closes the leftover), and
// this is what the test printed for it.
// 2026-09-19 (evening): readFileTab hands the worktree's terminal handles
// (the active tab's first) to resolveMobileFileTabDoc, so a desktop-opened
// tab whose path is outside the worktree reads through a terminal-artifact
// grant, and names 'outside_worktree' when nothing vouches for the path.
// 2026-09-23 (Orca #21790 and #21785 ported): the clipboard seam's writer and
// reader in the copy, paste and probe bodies, the Markdown copy's failure
// branch, and the terminal subscribe's snapshotByteBudget spread (nothing on a
// phone, the bridge frame cap inside the shell's page). Same callbacks.
// 2026-09-24: the gesture gate checks each sequence against the program's
// modes and encoding, the flush admits a row only inside the terminal's
// output window (holding the rest on the phone, a reversal let through at
// once), and the subscribe's data branch notes the output. Same callbacks.
// 2026-09-24 (Orca #22256): both dictation failure paths call reportDictationFailure.
// 2026-09-25 (Orca #22300): the live field's submit body moved out of the dock's JSX into
// submitLiveInput, and the per-render submitBufferedDraft calls handleSend.
// 2026-09-26: readMarkdownTab reads the disk on any refusal of the tab and
// keeps the desktop's reason; readFileTab's generic copy carries the reason.
// Then: it never reads the disk for a file the desktop called binary, read off
// the refusal's code and message both.
// 2026-09-30: a live terminal dictation's target comes from ptyDictationTarget in
// startDictation, and cancelDictation erases through eraseLiveTranscript instead of
// sending its own delta (live-terminal-dictation.ts, which counts only the bytes the
// terminal took). Only those two bodies moved. Same callbacks.
// 2026-10-06 (Orca #24655 ported): readFileTab's two writes land only while their own loading record
// is the tab's current one, and an accepted file-tab close deletes the tab's cached document. Same
// callbacks; the bodies of readFileTab and handleCloseSessionTab moved. And (#24759) showToast skips a
// disposed owner.
const HEAD_CALLBACK_BODY_SHA256 = 'c125df2c01207fcd85b59c0eb6ec867f8c65ffb49f2d63e8b415a12d5980c6da'
// 2026-09-19 (Orca #21083 ported): the startup effect's two worktree.activate
// sends became host-screen's worktreeActivate, and the sleeping-agent check
// reads that operation's verdict instead of the reply envelope. Same 23
// effects.
// 2026-09-19 (Orca #21503 port): the last-visited-worktree effect's bare store
// write became writeLastVisitedWorktree, the one writer of that key, so the
// hybrid shell's page mirror sees it as it is written rather than one `init` later.
// Re-pinned on the group E merge, 2026-09-19: main's hash (da074a63) carried
// the perf-group effects, ours (0a93fb85) carried this one; the merged tree
// carries both, and this is what the test printed for it.
// Re-pinned again on the group D merge, 2026-09-19: main's (6121e237) carried
// #21503's writer, ours (d5529ed9) #21083's worktreeActivate; both now.
// 2026-09-24 (Orca #22111 ported, 0b1567a7b): the diff-comments mount effect
// now ends in `.catch(() => undefined)`, so a rejected worktree.show is no longer
// an unhandled rejection on every mount. Only that effect's body moved; still 25.
// 2026-09-24 (Orca #22252): the Keyboard listener effect became two effects off
// useSoftKeyboard, visibility and height (26).
// 2026-10-04 (Orca #24301): the capability probe effect also clears and sets
// agent-session.repeated-stop.v1 beside prompt-cancel. Only that effect's body moved; still 26.
const HEAD_EFFECT_SHA256 = 'f17512e385d4cd804c40f8876c03e40215c4f75fc85999371880e02ae9826faa'
// 21 since 2026-09-18: FileReader's line-selection mode ("Ask about lines",
// Alt+K parity) adds useTheme's colors binding, the lineSelection state pair,
// the relativePath-keyed reset effect, and the range/highlight-style memos —
// four new bindings on top of the prior 17.
// 2026-09-19: MarkdownReader binds useScrollReadingPosition (22 bindings).
// 17 since 2026-09-26: the file tab's source view moved out of FileReader into MobileSessionFileSource
// (the code viewer: no wrap, indent guides, themed colours), which is outside this family.
// Five FileReader bindings left with it: useTheme, the lineSelection pair, its
// reset effect, the highlight-style memo, and the fileSyntax pair (the viewer
// colours itself now). Nothing else in the family moved.
// 2026-09-27 (theme sweep): MarkdownReader, DiffLineRow and FileReader each moved off the static
// `mobile-theme` palette onto `useTheme()` + `useThemedStyles(sessionStyles)` — see the count
// comment above.
// 2026-09-27 (theme pass 2): DiffLineRow's `useTheme()` binding also takes `syntax`, the palette
// its code spans now get instead of MobileSyntaxSegments' old Dark+ default. Same 22 bindings;
// reverting that one file restores the previous hash.
const HEAD_CONTENT_HOOK_SHA256 = '94c9cd0019cba558ea4415f7769527e1f2e7840977eed1b4b7f2bd9432a7060c'
// 2026-09-06: Codex server creation now reports unsupported hosts instead of
// falling back to a terminal (d3e102b); reviewed alongside image-paste ordering.
// 2026-09-09: handleCreateTerminal resolves the HUD beacon launch config first.
// 2026-09-10: a bare launch gates on isAgentSessionHandleProvider instead of the
// 'codex' literal, so Claude opens a structured chat too. Claude still falls
// through to the terminal (and its HUD beacon) when the host cannot open one,
// Codex still refuses, and the refusal copy names the agent instead of always
// saying "Codex". Ablated against the pre-change tree: the whole suite passed
// with every other file of this port in place, so create-actions is the sole
// cause of both moved pins.
// 2026-09-10: visible terminals request phone cols even when Chat UI is off.
// 2026-09-10: a tab close now plans against the current strip, so a lone leaf
// closes through session.tabs.close instead of being addressed as a split.
// Moved by one line in handleCloseSessionTab (planSessionTabClose gains the
// sibling argument); no other nested body changed.
// 2026-09-10: the split-leaf close stopped repeating — the repeat loop in
// handleCloseSessionTab became a single await, because a second terminal.close
// on the dead handle made the host close the whole tab. Same one function.
// 2026-09-18: handleForkClaudeSession joins handleClearTerminal inside
// useMobileSessionTerminalInput — the session menu's Fork action types
// Claude's own `/fork` command and submits it.
// 2026-09-19 (Orca #20891 ported): six nested functions send through declared
// operations — the markdown note and browser creates, the browser navigation
// command, and the terminal rename, terminal close and session-tab close (the
// last two keep this fork's early-return and close-plan shape). Count still 13.
// 2026-09-19 (Orca #20915 ported): handleSend, the composed draft send, names
// terminal.input-send. Count still 13.
// 2026-09-19 (Orca #20954 ported): handleClearTerminal names
// terminal.clear-buffer-or-skip. Count still 13.
// 2026-09-19 (Orca #21083 ported): handleCreateTerminal names
// sessionTabCreateTerminal, and its `response.ok` branch became that
// operation's own throw-the-host-message acceptance; this fork's HUD launch
// config still rides the create. Count still 13.
// 2026-09-19 (Orca #21089 ported): handleCreateBrowser's
// `{ browserPageId?: string }` cast is carried by its schema now. Count
// still 13.
// 2026-09-19 (upstream #20069): handleCreateTerminal captures one afterTabId
// for both the request and the optimistic paint, places the created tab with
// the shared placeCreatedSessionTab, and paints nothing at all against a host
// without session-tabs.split-group-placement.v1 (its snapshot places it).
// Re-pinned on the group D merge, 2026-09-19: main's (b014e15d) carried
// #20069's placement, ours (ccff5b6c) the operation sends; handleCreateTerminal
// now does both — sessionTabCreateTerminal, then the guarded placement.
// 2026-09-27: handleForkClaudeSession types `/fork` only with no dialog on
// screen (forkClaudeSessionUnlessDialog) and toasts the refusal when there is
// one; its two toast strings stay in the handler. Same one function; count
// still 13.
// 2026-10-06 (Orca #24655 ported): handleCloseSessionTab's body gains the file-tab document release.
// Same 13 functions.
const HEAD_NESTED_FUNCTION_SHA256 =
  'af8c4b72bf8c7c507c31beeeb26905202a052fa5012c0ed73bf62593b49b67a5'
// 7 since 2026-09-22: AppState.addEventListener stops a dictation take when a call backgrounds the app.
// 5 since 2026-09-24 (Orca #22252): the route's Keyboard.addListener pair is gone; the
// keyboard state now reads useSoftKeyboard from the platform seam.
const HEAD_NATIVE_REGISTRATION_SHA256 =
  '9f7c866c750c575c75a430cd1c663e231920fdb563cb4bd8ef720d7a0bd3e9a0'
// 2026-09-24 (Orca #22252): the Keyboard pair's two remove() calls leave with it.
const HEAD_NATIVE_REMOVAL_SHA256 =
  '40a1ad5717c027fcf93188541ede2dbc82d6dee40e948e9c5c8bb4b7fb15da20'
// 2026-09-24: the gesture flush's re-poll while the output window holds its
// rows on the phone (8 setTimeout creations, from 7).
// 2026-09-26: FileReader's deferred-highlight timer lost its file/html branch;
// the source views colour themselves in the code viewer. Same count (10).
const HEAD_TIMER_CREATION_SHA256 =
  '5dbfb8cc5d46d019de4443f154f43a4add15ef6484a59b0e1bfcfe0ff23cf068'
const HEAD_TIMER_CLEANUP_SHA256 = '1fe4ac8e695b6da1f471d7546d79ee62a27b9a582eb1eaa0f9e1f00ee36a7fa0'
// 656 since 2026-09-18: askAboutFileLines's "No chat is open to ask about
// this file" refusal toast, plus the 'terminal' literal in its
// plan.targetTab.type check (only a 'terminal' tab's chat view can be toggled;
// an 'agent-session' tab's is always on).
// 658 since 2026-09-18 (later): handleForkClaudeSession's two toast strings
// ("Forking from the latest message" / "Couldn't fork the session"). Its
// action-sheet label and hint live in mobile-terminal-action-sheet-actions.ts,
// outside this family, so they don't move this pin.
// 661 since 2026-09-18 (later still): askAboutTerminalScreen's "No chat is
// open to ask about this screen" refusal toast, plus two more 'terminal'
// literal occurrences — the sourceTab lookup's tab.type check, and its own
// plan.targetTab.type check mirroring askAboutFileLines's above (the 'terminal'
// LENGTH counted here is per occurrence, not per distinct string). "Ask about
// this screen"'s own label lives in mobile-terminal-action-sheet-actions.ts,
// outside this family, same as Fork's.
// 676 since 2026-09-18 (newest): the three new session-menu entries in
// MobileSessionHeaderMoreActionsSheet.tsx — "MCP Servers", "Permission
// Rules" and "Project Memory" — each with a hint string naming its file and
// "project scope only" (+15 on top of the 661 above).
// 677 since 2026-09-18 (later): MobileSessionActiveContent asks the host's
// mobile RPC gate about 'agentSession.rewind' (useHostMobileCapability) —
// one new literal, the capability key.
// 671 since 2026-09-19 (Orca #20891 ported): twelve method literals left the
// family for the operation modules (browser.tabCreate, files.createFile,
// files.open, files.read, markdown.readTab, markdown.saveTab,
// session.tabs.close, terminal.close, terminal.list, terminal.rename,
// worktree.set, worktree.show) and six arrived with the migrated files — the
// browser navigation command's three 'browser.back'/'forward'/'reload' arms
// and three '' fallbacks. Checked by diffing the reader's output against the
// pre-port tree; upstream's own count moved by the same six.
// 668 since 2026-09-19 (Orca #20915 ported): the three method literals that
// became operation definitions — one repo.list and two terminal.send — and
// nothing else, the same three upstream lost (540 → 537 there).
// 666 since 2026-09-19 (Orca #20954 ported): terminal.send and
// terminal.clearBuffer are fixed at their operations' definitions instead of
// spelled in the gesture flush and the menu's clear — the same two upstream
// lost.
// 662 since 2026-09-19 (Orca #21083 ported): worktree.activate twice,
// session.tabs.createTerminal and terminal.setDisplayMode are fixed at their
// operations' definitions — the same four upstream lost (535 → 531 there).
// 678 since 2026-09-19 (later): the 'terminal' literal in applySessionTabs' leftover filter.
// 663 on the group D merge, 2026-09-19: main's 678 less the fifteen method
// literals the operation modules took (671 → 662 above, counted from 677),
// plus main's one leftover-filter literal. Re-pinned from the test's output.
// 664 since 2026-09-19 (Orca e7da72c3d ported, merged after group D): the
// 'agentStatus' key useMobileSessionAttachments reads the tab's agent through,
// so an image pastes as the agent's own attachment form or as an @file mention.
// 666 since 2026-09-19 (evening): 'outside_worktree' and its copy in readFileTab.
// 676 since 2026-09-22: AppState's 'change' event and the 'active' check that
// stops dictation when a call backgrounds the app.
// 678 since 2026-09-23 (Orca #21790, C7.2): the two toasts a refused clipboard
// write now shows, "Couldn't copy path" in the sheets and "Couldn't copy" in
// the Markdown copy action.
// 2026-09-24: the gesture flush's '' direction fallback (679).
// 673 since 2026-09-24 (Orca #22252): the Keyboard pair's six literals ('ios'
// twice and its four event names) leave with it; useSoftKeyboard owns the
// listeners now.
// 674 since 2026-09-25 (Orca #22362): the Markdown actions' 'web' check, which holds the page's
// Back claim to the page.
// 682 since 2026-09-26: the markdown and file readers' copy with the desktop's reason.
// 681 since the same day: the reader's 'Read only' gives way to the reason itself.
// 676 since 2026-09-26 (later): the file tab's source view moved out of FileReader into MobileSessionFileSource
// (the code viewer: no wrap, indent guides, themed colours), which is outside this family.
// Five literals left with it: 'file' and 'html' (the effect's source branch),
// 'plain' (the unhighlighted segment), and the two quasis of `${title} preview`.
// 677 since 2026-09-29: MobileSessionHeader's <TabActivityBadge> call is handed
// `watching={connState === 'connected' && …}`, so a tab's reading notes no turn
// while the phone is not watching the pane (native-chat-kept-session.ts). The
// one new literal is that 'connected'.
// 675 since 2026-09-30: MobileSessionActiveContent's permission-mode picker
// reads the footer through terminal-mode-stepper's shownPermissionMode, which
// is outside this family, so the 'default' and 'manual' of its old inline
// asShown leave with it. No other literal moved.
// 671 since 2026-09-30 (later): startDictation's `{ kind: 'pty', handle, typed: '' }`
// and cancelDictation's own erase (`liveDictationDelta(target.typed, '')`, then
// `target.typed = ''`) moved into live-terminal-dictation.ts, outside this family:
// one 'pty' and three '' leave. Checked by diffing the reader's output against
// 0bf636a3; no other literal moved.
// 670 since 2026-10-04: TabActivityBadge's dot moved into session-tab-activity.ts's
// tabPillDotState, outside this family, so the expression's `: 'idle'` leaves with it. The header
// now calls `tabPillDotState(status, now, leadTurnEnded)` and holds no other literal of it.
// 671 since 2026-10-06 (Orca #24655 ported): the `'file'` check before an accepted file-tab close
// releases that tab's document; no other literal moved.
const HEAD_RUNTIME_STRING_SHA256 =
  '1b367405f456cd52d5285cb36a3484b6e23e4d26bd22b5e0b79c8e7187336db1'
// 2026-09-17 (0.6.7): tap targets. Five session-route FILES, six sites (the key
// strip has two Pressables), drawn at 40 dp or less: the header's 32 dp tabs,
// the dock's 36 dp button, the key strip's 30 dp keys, the ask sheet's 30 dp
// QUESTION TAB STRIP, and the background-tasks sheet's 40 dp "load more". They
// gained `hitSlop={tapTargetHitSlop(…)}`.
// (Said "the ask sheet's options"; a review caught it. OptionRow is
// padding-sized, so the audit never saw it and it got nothing. Check with
// `grep -c hitSlop src/session/MobileNativeChatAsk.tsx`, which is 1.) That is one more
// attribute on host records at the same count (99); strings, leaf and style
// references are untouched and still match their earlier pins.
// 2026-09-17 (0.6.7, later): the .md reader paints its own page from the live
// theme. Its root and its two state views gained a themed `surface` entry in
// their style arrays and the read error a themed `error` entry: host records
// at the same count (99), everything else unchanged.
// 2026-09-18: FileReader's line-selection mode wires selectable/highlighted/
// highlightStyle/onLongPress/onPress onto the existing MobileSyntaxLine call
// inside its FlatList renderItem and adds a sibling conditional (the action
// bar) beside the FlatList — host record COUNT stays 99 (MobileSyntaxLine and
// the new MobileSessionFileReaderLineActionBar are custom components, not
// HOST_COMPONENT_NAMES), but the FlatList/View records' captured shape moved.
// 2026-09-18 (evening): the header's model pill View gained flexShrink/minWidth
// so a long live label truncates instead of running under the terminal icon.
// Same host record COUNT (99); that one View's captured style moved.
// 2026-09-19: the .md tab's Preview ScrollView spreads the reading-position
// props; FileReader and MarkdownReader take readingPositionKey.
// 2026-09-25 (Orca #22300): both of the dock's fields take their ref from the submit binding,
// and the live one's onSubmitEditing is submitLiveInput. Same host record COUNT (99).
// 2026-09-25 (Orca #22326): the header's "tap to retry" press also checks the
// re-dial exists, because the page's provider hands out none. Same host record
// COUNT (99); that one Pressable's captured onPress moved. Nothing a phone
// renders or does changed.
// 97 since 2026-09-26: the file tab's source view moved out of FileReader into MobileSessionFileSource
// (the code viewer: no wrap, indent guides, themed colours), which is outside this family.
// Its View and FlatList left with it.
// 2026-09-27 (theme sweep): Same host record COUNT (97); MarkdownReader's own page and error
// containers now carry their background straight off `styles.markdownState`/`styles.markdownEditor`
// (both themed in mobile-session-frame-styles.ts) instead of an array merged with a local
// `modeStyles.surface` override — those two Views' captured style expressions moved.
// 2026-10-04: the header's tab Pressable takes its fill from tabPillBackground (tab-pill-surface.ts),
// the same three theme tokens it chose inline, so the contrast test can measure the dot on each.
// Same host record COUNT (97); that one Pressable's captured style moved.
const HEAD_HOST_JSX_SHA256 = 'a2aeb7b7c4b1c693e5f2c3d19576f1d07eb076d1a0c522daa4156eca9e069751'
// 2026-09-06: queue editor controls added to the terminal dock.
// 2026-09-09 (night): the PDF viewer in the session file tab gets its file name
// for the Download button.
// 2026-09-15 (later): the markdown file tab reaches upstream Orca's own
// MobileFileMarkdownPreview instead of this fork's hand-rolled one, and hands it
// the path and the host's truncation facts alongside the source view it already
// lent. Exactly one leaf record changed — verified by extracting the reader's
// JSX records before and after; host and style-reference records are untouched,
// which is why only this pin moved.
// 2026-09-18: the line-selection action bar is one new leaf record (the
// FileReader-level <MobileSessionFileReaderLineActionBar> call); style
// references are untouched — its own styling is inline, in its own file.
// 2026-09-18 (later): MobileSessionActiveContent's <FileReader> call gained
// the onAskAboutLines prop — same leaf COUNT (72), the existing record's
// captured shape moved.
// 2026-09-18 (later still): the subagent transcript viewer.
// MobileSessionActiveContent mounts one <MobileSubagentTranscriptModal hostId
// worktreeId/> beside the chat overlay — one new leaf record (72 → 73);
// strings, host and style-reference records are untouched.
// 2026-09-18 (same day): MobileSessionSheets' terminal ActionSheetModal gained
// one more getMobileTerminalActionSheetActions() argument (`onFork`), which
// lengthens that one leaf record's canonicalized `actions=` attribute text —
// same 73 records, one of them different — since the record is the whole
// attribute expression, not a per-argument entry.
// 2026-09-18 (same day, later): the chat overlay is handed `onRevertHunk`
// beside `onOpenFile`. Same 73 leaf records; only the overlay's record changed.
// 2026-09-18 (same day, later still): the sheets' action call gained two more
// arguments (resolveAskAboutScreenTarget, onAskAboutScreen) — same 73 records,
// that one leaf's captured shape moved again.
// 2026-09-18 (newest), same shape again: MobileSessionHeaderMoreActionsSheet's
// <ActionSheetModal actions={[…]} /> is the one leaf record that moved — its
// `actions=` array literal gained the three new project-config entries (MCP
// Servers / Permission Rules / Project Memory). Still 73 records.
// 2026-09-18 (later): the chat overlay is handed `hostAllowsRewind` beside
// `onRevertHunk` — the mobile RPC gate's answer for agentSession.rewind, ANDed
// with the session's own rewindSupport inside the overlay. Same 73 records;
// only the overlay's record changed. Host and style references untouched.
// 2026-09-19: FileReader hands readingPositionKey to the PDF and markdown views,
// and (later) resolveImage to the markdown view; MarkdownReader's Preview
// hands MobileMarkdown resolveImage too, so a document's figures draw.
// 2026-09-24: MobileSessionHeader's <TabActivityBadge> call gained
// `leadTurnEnded` (e9df676a), so the active tab's pill stops spinning once
// Claude's own turn has ended. Same record count; only that record moved.
// 2026-09-25: MobileSessionSurface's <MobileFileTapMatchPicker picker=...> is
// the one new record (74).
// 2026-09-25: the chat overlay is handed `onSendFailure` (nativeChatSendError.show)
// beside `onClearSendError`, so the Background tasks sheet can say a failed Stop
// itself and hand on what it cannot show. Same record count; only the overlay's
// record moved.
// 2026-09-26: the chat overlay is handed `createdFileCounts` beside
// `onRevertHunk`, the store that reads back a created file the wire cut for its
// line count. Same record count; only the overlay's record moved.
// 2026-09-26 (later): MobileSessionSheets' Markdown and file tab
// <ActionSheetModal actions={[…]} /> each gained a
// `...saveToPhoneSheetActions(controller, target, dismiss)` spread, "Save to
// Phone" for the tab's file. Its label, hint and toasts live in
// mobile-session-save-to-phone-action.ts, outside this family, so the string
// pin did not move. Same record count; only those two records moved.
// 73 since 2026-09-26: the file tab's source view moved out of FileReader into MobileSessionFileSource
// (the code viewer: no wrap, indent guides, themed colours), which is outside this family.
// MobileSyntaxLine and the line action bar left; MobileSessionFileSource came in.
// 2026-09-26 (later still): FileReader's <MobileFileMarkdownPreview> call no
// longer hands it `byteLength`. On a cut read that is what the host read, not
// the file's size, and the truncated note called every file over the cap
// 512 KB; the note now names the cap instead. Same record count (73); only
// that record moved.
// 2026-09-27: the file tab tells its source view the file was truncated
// (review should-fix: it copied partial text as "Copy file", with no notice).
// Same record count; two records moved, checked by dumping the facts before
// and after: MobileSessionFileSource gains `truncated` and `byteLength`, and
// the markdown preview's renderSource passes doc.truncated and
// doc.byteLength. Every other fact set is unchanged.
// 2026-09-27 (merging main into fix/save-to-phone): those two records lose
// `byteLength` again, for the same reason as the preview's note above: the
// file tab's notice (previewTruncatedText) names the cap, not a size the
// phone is never told. Same record count (73); only those two records moved.
// 2026-09-27 (theme sweep): several leaf icon `color` props moved off the static `mobile-theme`
// palette (e.g. `colors.textPrimary`) onto the live `useTheme()` colours (`colors.text`) in
// MarkdownReader, DiffLineRow and FileReader. Same record count (73); only those records' captured
// expressions moved.
// 2026-09-27 (theme pass 2): DiffLineRow's <MobileSyntaxSegments> gains `palette={syntax}`. Same
// 73 records; reverting that one file restores the previous hash.
// 2026-09-28: MobileSessionHeader's <TabActivityBadge> call gains `keptKey` and
// `agent`, so a nested agent's status on the pane (a Grok launched from
// Claude's Bash tool) draws no dot (native-chat-kept-session.ts). Same 73
// records; only that record moved.
// 2026-09-29: the same <TabActivityBadge> call gains `turnCompletedAt` (the
// tab's hook-stamped turn end) and `watching`, so the header keeps the lead's
// session while its background work runs and a nested Claude posts as the
// pane (native-chat-kept-session.ts). Same 73 records; only that record moved.
// 2026-10-04 (xterm only): <TerminalPaneView> loses its `engine` prop, the phone draws every pane
// with the WebView now. Same 73 records; only that record moved.
const HEAD_LEAF_JSX_SHA256 = 'b66d13b81b0f8bea994b46aca2e938aef716d5c7f05b964ae6993a5f9cb8f738'
// 85 since 2026-09-26: the same move takes the old reader's seven style
// references (markdownEditor, filePreviewScroll/Content, filePreviewText and
// filePreviewGutter twice each).
const HEAD_STYLE_REFERENCE_SHA256 =
  '859461aa348d6ff8a768020862054aaa3fde7a6d6f60e990648f4c2eb5d2684e'
// 2026-09-18: handleForkClaudeSession's own `deviceToken: deviceTokenRef.current`
// read joins the same-shaped reads terminal.send already made elsewhere in the
// family — one more occurrence of an existing identity-field pattern, not a
// new one.
const HEAD_IDENTITY_FIELD_SHA256 =
  '93970ef0061d184c87ea4ae96f7017d7477235f2fb0a686534d84ff7bb0e7d74'
// 9 since 2026-09-18 (newest): useMobileSessionPanelRouteActions gained
// openMcpServers/openPermissionRules/openProjectMemory — three router.push
// navigators for the new project-config screens (MCP servers, permission
// rules, project memory), each session-menu entries alongside Agent History.
const HEAD_NAVIGATION_SHA256 = '3a02dc91d91dffc6fe7f20a88a03f6a1f131badc4a85b4b16bbd2234f3079f96'
// 2026-10-04 (Orca #24301): agent-session.repeated-stop.v1 joins prompt-cancel in the probe.
const HEAD_CAPABILITY_SHA256 = 'f383f0560334f563fb3c2be792c1c68c166dd4735885d8962705d729901f5a11'

type Definition = { declaration: ts.FunctionDeclaration; sourceFile: ts.SourceFile }
type HookFacts = {
  bindings: string[]
  callbackBodies: string[]
  callbacks: string[]
  effects: string[]
  hooks: string[]
}

const printer = ts.createPrinter({ removeComments: true })
const sourceFiles = new Map<string, ts.SourceFile>()

function parse(relativePath: string): ts.SourceFile {
  const cached = sourceFiles.get(relativePath)
  if (cached) {
    return cached
  }
  const filePath = fileURLToPath(new URL(relativePath, import.meta.url))
  const sourceFile = ts.createSourceFile(
    relativePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  sourceFiles.set(relativePath, sourceFile)
  return sourceFile
}

function canonical(node: ts.Node, sourceFile: ts.SourceFile): string {
  return printer.printNode(ts.EmitHint.Unspecified, node, sourceFile).replace(/\s+/g, '')
}

function hash(values: readonly string[]): string {
  return createHash('sha256').update(values.join('\n')).digest('hex')
}

function readDefinitions(): Map<string, Definition> {
  const definitions = new Map<string, Definition>()
  for (const relativePath of SESSION_FILES) {
    const sourceFile = parse(relativePath)
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        definitions.set(node.name.text, { declaration: node, sourceFile })
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return definitions
}

function visitLogicalFunction(
  name: string,
  definitions: ReadonlyMap<string, Definition>,
  onNode: (node: ts.Node, sourceFile: ts.SourceFile) => void,
  active = new Set<string>()
): void {
  const definition = definitions.get(name)
  if (!definition?.declaration.body) {
    throw new Error(`Missing session function: ${name}`)
  }
  if (active.has(name)) {
    throw new Error(`Recursive session function: ${name}`)
  }
  const nextActive = new Set(active).add(name)
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      LOGIC_EXPANSION_NAMES.has(node.expression.text)
    ) {
      visitLogicalFunction(node.expression.text, definitions, onNode, nextActive)
      return
    }
    onNode(node, definition.sourceFile)
    ts.forEachChild(node, visit)
  }
  visit(definition.declaration.body)
}

function readHookFacts(name: string, definitions: ReadonlyMap<string, Definition>): HookFacts {
  const facts: HookFacts = {
    bindings: [],
    callbackBodies: [],
    callbacks: [],
    effects: [],
    hooks: []
  }
  visitLogicalFunction(name, definitions, (node, sourceFile) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      !/^use[A-Z]/.test(node.expression.text)
    ) {
      return
    }
    const hookName = node.expression.text
    facts.hooks.push(hookName)
    const owner = ts.isVariableDeclaration(node.parent)
      ? node.parent.name.getText(sourceFile)
      : ts.isExpressionStatement(node.parent)
        ? '<statement>'
        : ts.isCallExpression(node.parent) && ts.isIdentifier(node.parent.expression)
          ? `<argument:${node.parent.expression.text}>`
          : '<nested>'
    const lastArgument = node.arguments.at(-1)
    const dependencies =
      lastArgument && ts.isArrayLiteralExpression(lastArgument)
        ? canonical(lastArgument, sourceFile)
        : '<none>'
    facts.bindings.push(`${hookName}|${owner}|${dependencies}`)
    if (hookName === 'useCallback') {
      facts.callbacks.push(`${owner}|${dependencies}`)
      facts.callbackBodies.push(
        `${owner}|${canonical(node.arguments[0], sourceFile)}|${dependencies}`
      )
    }
    if (hookName === 'useEffect') {
      facts.effects.push(`${canonical(node.arguments[0], sourceFile)}|${dependencies}`)
    }
  })
  return facts
}

function readNestedFunctions(definitions: ReadonlyMap<string, Definition>): string[] {
  const functions: string[] = []
  const visitDefinition = (name: string, active: ReadonlySet<string>): void => {
    const definition = definitions.get(name)
    if (!definition?.declaration.body || active.has(name)) {
      throw new Error(`Invalid nested-function stage: ${name}`)
    }
    const nextActive = new Set(active).add(name)
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        LOGIC_EXPANSION_NAMES.has(node.expression.text)
      ) {
        visitDefinition(node.expression.text, nextActive)
        return
      }
      if (ts.isFunctionDeclaration(node) && node.name) {
        functions.push(`${node.name.text}|${canonical(node, definition.sourceFile)}`)
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(definition.declaration.body)
  }
  visitDefinition(ROOT_COMPONENT, new Set())
  return functions
}

function readNativeAndTimerFacts(definitions: ReadonlyMap<string, Definition>): {
  cleanups: string[]
  creations: string[]
  registrations: string[]
  removals: string[]
} {
  const registrations: string[] = []
  const removals: string[] = []
  const creations: string[] = []
  const cleanups: string[] = []
  const collect = (node: ts.Node, sourceFile: ts.SourceFile): void => {
    if (!ts.isCallExpression(node)) {
      return
    }
    if (ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression.getText(sourceFile)
      const method = node.expression.name.text
      if (
        ['BackHandler', 'AppState', 'Keyboard'].includes(receiver) &&
        ['addEventListener', 'addListener'].includes(method)
      ) {
        registrations.push(canonical(node, sourceFile))
      }
      if (method === 'remove') {
        removals.push(canonical(node, sourceFile))
      }
    }
    if (ts.isIdentifier(node.expression)) {
      if (['setTimeout', 'setInterval', 'requestAnimationFrame'].includes(node.expression.text)) {
        creations.push(canonical(node, sourceFile))
      }
      if (
        ['clearTimeout', 'clearInterval', 'cancelAnimationFrame'].includes(node.expression.text)
      ) {
        cleanups.push(canonical(node, sourceFile))
      }
    }
  }
  visitLogicalFunction('FileReader', definitions, collect)
  visitLogicalFunction(ROOT_COMPONENT, definitions, collect)
  return { cleanups, creations, registrations, removals }
}

function isRuntimeNode(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      ts.isImportDeclaration(parent) ||
      ts.isExportDeclaration(parent) ||
      ts.isImportTypeNode(parent) ||
      ts.isTypeNode(parent)
    ) {
      return false
    }
  }
  return true
}

function readRuntimeStrings(): string[] {
  const values: string[] = []
  for (const relativePath of SESSION_FILES) {
    const visit = (node: ts.Node): void => {
      if (isRuntimeNode(node)) {
        if (
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)
        ) {
          values.push(node.text)
        }
        if (ts.isJsxText(node) && node.text.trim()) {
          values.push(node.text.replace(/\s+/g, ' ').trim())
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(parse(relativePath))
  }
  return values.sort()
}

function readJsxFacts(definitions: ReadonlyMap<string, Definition>): {
  host: string[]
  leaf: string[]
  styleReferences: string[]
} {
  const host: string[] = []
  const leaf: string[] = []
  const active = new Set<string>()
  const visitDefinition = (name: string): void => {
    const definition = definitions.get(name)
    if (!definition?.declaration.body || active.has(name)) {
      throw new Error(`Invalid JSX stage: ${name}`)
    }
    active.add(name)
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        LOGIC_EXPANSION_NAMES.has(node.expression.text)
      ) {
        visitDefinition(node.expression.text)
        return
      }
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node
        const tagName = opening.tagName.getText(definition.sourceFile)
        if (SURFACE_EXPANSION_NAMES.has(tagName)) {
          visitDefinition(tagName)
          return
        }
        const attributes = opening.attributes.properties
          .map((attribute) => {
            if (ts.isJsxSpreadAttribute(attribute)) {
              return `...${canonical(attribute.expression, definition.sourceFile)}`
            }
            const attributeName = attribute.name.getText(definition.sourceFile)
            if (!attribute.initializer) {
              return attributeName
            }
            if (ts.isStringLiteral(attribute.initializer)) {
              return `${attributeName}=${JSON.stringify(attribute.initializer.text)}`
            }
            return `${attributeName}=${
              attribute.initializer.expression
                ? canonical(attribute.initializer.expression, definition.sourceFile)
                : ''
            }`
          })
          .join(',')
        ;(HOST_COMPONENT_NAMES.has(tagName) ? host : leaf).push(`${tagName}|${attributes}`)
        for (const attribute of opening.attributes.properties) {
          ts.forEachChild(attribute, visit)
        }
        if (ts.isJsxElement(node)) {
          for (const child of node.children) {
            visit(child)
          }
        }
        return
      }
      if (ts.isJsxFragment(node)) {
        for (const child of node.children) {
          visit(child)
        }
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(definition.declaration.body)
    active.delete(name)
  }
  for (const name of CONTENT_COMPONENT_NAMES) {
    visitDefinition(name)
  }
  visitDefinition(ROOT_COMPONENT)
  const styleReferences: string[] = []
  for (const record of [...host, ...leaf]) {
    for (const match of record.matchAll(/styles\.([A-Za-z0-9_]+)/g)) {
      styleReferences.push(match[1])
    }
  }
  return { host, leaf, styleReferences }
}

function readCompatibilityFacts(definitions: ReadonlyMap<string, Definition>): {
  capabilities: string[]
  identityFields: string[]
  navigation: string[]
} {
  const capabilities: string[] = []
  const identityFields: string[] = []
  const navigation: string[] = []
  visitLogicalFunction(ROOT_COMPONENT, definitions, (node, sourceFile) => {
    if (!isRuntimeNode(node)) {
      return
    }
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(sourceFile)
      if (['notifyClients', 'deviceToken', 'clientId'].includes(name)) {
        identityFields.push(`${name}|${canonical(node.initializer, sourceFile)}`)
      }
      if (
        name === 'client' &&
        ts.isObjectLiteralExpression(node.initializer) &&
        node.initializer.properties.some(
          (property) => property.name?.getText(sourceFile) === 'id'
        ) &&
        node.initializer.properties.some(
          (property) => property.name?.getText(sourceFile) === 'type'
        )
      ) {
        identityFields.push(`client|${canonical(node.initializer, sourceFile)}`)
      }
    }
    if (!ts.isCallExpression(node)) {
      return
    }
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(sourceFile) === 'router' &&
      ['push', 'replace', 'back'].includes(node.expression.name.text)
    ) {
      navigation.push(canonical(node, sourceFile))
    }
    const callName = ts.isIdentifier(node.expression)
      ? node.expression.text
      : ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : ''
    const callText = canonical(node, sourceFile)
    if (
      ['startRuntimeCapabilityProbe', 'supportsMobileQuickCommands'].includes(callName) ||
      (callName === 'includes' && callText.includes('capabilities.includes'))
    ) {
      capabilities.push(callText)
    }
  })
  return { capabilities, identityFields, navigation }
}

describe('mobile session route extraction parity', () => {
  it('preserves hooks, callbacks, effects, and nested action bodies', () => {
    const definitions = readDefinitions()
    const main = readHookFacts(ROOT_COMPONENT, definitions)
    const contentBindings = CONTENT_COMPONENT_NAMES.flatMap(
      (name) => readHookFacts(name, definitions).bindings
    )
    // 277 since 2026-09-15: the session tabs re-read a document when the host
    // reconnects — useLocalSearchParams, useLastConnectedAt and the ledger ref.
    // 278 since 2026-09-18: askAboutFileLines (use-mobile-session-file-actions).
    // 279 since 2026-09-18 (later): useMobileNativeChatHunkRevert, which binds
    // the diff cards' "Revert this hunk" to this session's client and tab.
    // 281 since 2026-09-18 (later still): resolveAskAboutScreenTarget and
    // askAboutTerminalScreen, the terminal's "Ask about this screen".
    // 282 since 2026-09-19: useHostProtocolGates in the foundation (#20069).
    // 283 since 2026-09-19: useTerminalCopyTrimsGutter (#20545), merged the same day.
    // 284 since 2026-09-19: structuredCancelPrompt (useNativeChatAcceptedAction),
    // the cancel-by-identity for a pending approval/question (Orca #20601).
    // 286 since 2026-09-19 (night): terminalHandlesFor (useCallback) and the
    // prefetch effect in useMobileSessionDocumentReaders — a desktop-opened
    // file outside the worktree is read while a terminal still shows its path.
    // 289 since 2026-09-22: the caret ref, the insert-range ref, and the
    // dictation paint state.
    // 294 since 2026-09-23: five clipboard seam hooks (Orca #21790).
    // 295 since 2026-09-24: the gesture output-window ref in the terminal input.
    // 296 since 2026-09-24: reportDictationFailure, the one policy both dictation failure entry
    // points now call (Orca #22256).
    // 298 since 2026-09-24 (later): useSoftKeyboard replaces the route's own Keyboard.addListener
    // pair, and its visibility and height now each own a separate effect (Orca #22252).
    // 301 since 2026-09-25: the terminal fields' submit seam — submitLiveInput (useCallback) and
    // one useTerminalTextFieldSubmitBinding per field in the send actions (Orca #22300).
    // 302 since 2026-09-25: the Markdown actions' page Back claim (Orca #22362).
    // 303 since 2026-09-26: useMobileSessionSaveToPhonePresence (the tab menu's Save to Phone).
    // 304 since 2026-09-30: useClipboardWriter in the dictation hook, where desktop dictation goes
    // when no field on screen can take it.
    // 305 since 2026-10-04: the repeated-stop capability's useState beside the prompt-cancel one
    // (Orca #24301; agent-session.repeated-stop.v1 from the same status probe).
    expect(main.hooks).toHaveLength(307)
    expect(hash(main.hooks)).toBe(HEAD_MAIN_HOOK_SHA256)
    expect(hash(main.bindings)).toBe(HEAD_HOOK_BINDING_SHA256)
    // 82 since 2026-09-19 (night): terminalHandlesFor in the document readers.
    // 83 since 2026-09-24: reportDictationFailure (Orca #22256).
    // 84 since 2026-09-25: submitLiveInput, the live field's one send seam (Orca #22300).
    expect(main.callbacks).toHaveLength(84)
    expect(hash(main.callbacks)).toBe(HEAD_CALLBACK_IDENTITY_SHA256)
    expect(hash(main.callbackBodies)).toBe(HEAD_CALLBACK_BODY_SHA256)
    // 24 since 2026-09-19 (night): the outside-worktree prefetch effect in the readers.
    // 25 since 2026-09-22: the dictation take stops when a call backgrounds the app.
    // 26 since 2026-09-24: the keyboard's visibility and height each own their own effect off
    // useSoftKeyboard, where one effect drove both off the raw Keyboard events (Orca #22252).
    // 27 since 2026-10-06: the feedback hook's mountedRef effect (Orca #24759).
    expect(main.effects).toHaveLength(27)
    expect(hash(main.effects)).toBe(HEAD_EFFECT_SHA256)
    // 22 since 2026-09-19: useScrollReadingPosition in MarkdownReader, the
    // .md tab's Preview scroller remembering where the reader was.
    // 17 since 2026-09-26: FileReader's source view moved to MobileSessionFileSource.
    // 22 since 2026-09-27 (theme sweep): MarkdownReader takes `{ colors }` off
    // `useTheme()` and its own `styles` off `useThemedStyles(sessionStyles)`
    // (+1, alongside its existing `modeStyles`); DiffLineRow and FileReader each
    // gain the same `{ colors }` + `styles` pair (+2 each) — both moved off the
    // static dark-only `mobile-theme` import onto the live theme.
    expect(contentBindings).toHaveLength(22)
    expect(hash(contentBindings)).toBe(HEAD_CONTENT_HOOK_SHA256)
    const nestedFunctions = readNestedFunctions(definitions)
    expect(nestedFunctions).toHaveLength(13)
    expect(hash(nestedFunctions)).toBe(HEAD_NESTED_FUNCTION_SHA256)
  })

  it('preserves native listeners, timers, identity payloads, and compatibility gates', () => {
    const definitions = readDefinitions()
    const native = readNativeAndTimerFacts(definitions)
    // 7 since 2026-09-22: AppState.addEventListener on the dictation take.
    // 5 since 2026-09-24: the route's own Keyboard.addListener pair moves into useSoftKeyboard,
    // which the platform seam owns instead (Orca #22252).
    expect(native.registrations).toHaveLength(5)
    expect(hash(native.registrations)).toBe(HEAD_NATIVE_REGISTRATION_SHA256)
    // 9 since 2026-09-22: the AppState subscription is removed with the dictation effect.
    // 7 since 2026-09-24: showSub.remove / hideSub.remove leave with the Keyboard pair
    // (Orca #22252).
    expect(native.removals).toHaveLength(7)
    expect(hash(native.removals)).toBe(HEAD_NATIVE_REMOVAL_SHA256)
    // 8 since 2026-09-24: the gesture flush re-polls a held queue.
    expect(native.creations.filter((fact) => fact.startsWith('setTimeout'))).toHaveLength(8)
    expect(native.creations.filter((fact) => fact.startsWith('setInterval'))).toHaveLength(1)
    expect(
      native.creations.filter((fact) => fact.startsWith('requestAnimationFrame'))
    ).toHaveLength(1)
    expect(hash(native.creations)).toBe(HEAD_TIMER_CREATION_SHA256)
    expect(native.cleanups.filter((fact) => fact.startsWith('clearTimeout'))).toHaveLength(11)
    expect(native.cleanups.filter((fact) => fact.startsWith('clearInterval'))).toHaveLength(1)
    expect(native.cleanups.filter((fact) => fact.startsWith('cancelAnimationFrame'))).toHaveLength(
      1
    )
    expect(hash(native.cleanups)).toBe(HEAD_TIMER_CLEANUP_SHA256)
    const compatibility = readCompatibilityFacts(definitions)
    expect(compatibility.identityFields).toHaveLength(16)
    expect(hash(compatibility.identityFields)).toBe(HEAD_IDENTITY_FIELD_SHA256)
    // 9 since 2026-09-18: the three new session-menu router.push navigators —
    // see HEAD_NAVIGATION_SHA256.
    expect(compatibility.navigation).toHaveLength(9)
    expect(hash(compatibility.navigation)).toBe(HEAD_NAVIGATION_SHA256)
    // 6 since 2026-09-19: agent-session.prompt-cancel.v1 (Orca #20601).
    // 7 since 2026-10-04: agent-session.repeated-stop.v1 (Orca #24301), which tells the chat a
    // /clear, /compact, rewind or Stop press is its own action on this host.
    expect(compatibility.capabilities).toHaveLength(7)
    expect(hash(compatibility.capabilities)).toBe(HEAD_CAPABILITY_SHA256)
  })

  it('preserves runtime strings, styles, and the expanded JSX tree', () => {
    const strings = readRuntimeStrings()
    // 620 since 2026-09-09: two align="center" props on the empty-state buttons.
    // 622 since 2026-09-09 (night): "data" and "string", from the guard that
    // strips the agents' HUD beacon out of an output chunk.
    // 629 since 2026-09-10: split-sibling Close names the handle-repeat plan.
    // 637 since 2026-09-15: a markdown file renders as a document with a source
    // toggle, the way the desktop has always shown it, instead of as raw text.
    // 654 since 2026-09-15 (later): the .md TAB gets its own Preview/Edit
    // toggle, so opening a document reads it instead of opening an editor.
    // 656 since 2026-09-15 (later): the hostId search param and the two
    // document statuses the reconnect refetch reads.
    // 654 since 2026-09-18: the header's model pill stopped reading the
    // session-options snapshot — its `'model'` category lookup and `'Model'`
    // placeholder check are gone — and reads the agent's live pair instead.
    // Check: `git show 17c20ff..HEAD -- MobileSessionHeader.tsx` removes exactly
    // those two literals.
    // 656 since 2026-09-18 (later): askAboutFileLines's refusal toast and its
    // 'terminal' literal, landing the same day as the model-pill removal above
    // dropped the count to 654.
    // 658 since 2026-09-18 (later still): handleForkClaudeSession's two toast
    // strings ("Forking from the latest message" / "Couldn't fork the session").
    // 676 since 2026-09-18 (newest): the three new session-menu entries —
    // MCP Servers / Permission Rules / Project Memory — see HEAD_RUNTIME_STRING_SHA256.
    // 677 since 2026-09-18 (later): the 'agentSession.rewind' capability key
    // MobileSessionActiveContent asks the mobile RPC gate about.
    // 678 since 2026-09-19 (later): the 'terminal' tab-type literal in
    // applySessionTabs' leftover filter (see HEAD_CALLBACK_BODY_SHA256).
    // 663 on the group D merge: see HEAD_RUNTIME_STRING_SHA256.
    // 664 since 2026-09-19 (upstream e7da72c3d): the 'agentStatus' key
    // useMobileSessionAttachments reads the tab's agent through, so an image
    // pastes as the agent's own attachment form or as an @file mention.
    // 666 since 2026-09-19 (evening): 'outside_worktree' and its reader copy
    // in readFileTab (see HEAD_CALLBACK_BODY_SHA256).
    // 674 since 2026-09-19 (night): the reader's "on Desktop" copy for a file
    // no terminal vouches for (Image/File + the reason), and the prefetch effect's
    // literals (see HEAD_MAIN_HOOK_SHA256).
    // 676 since 2026-09-22: 'change' and 'active' on the dictation AppState listener.
    // 678 since 2026-09-23: the two refused-copy toasts (Orca #21790).
    // 679 since 2026-09-24: the '' the gesture flush reads the next row's
    // direction through.
    // 673 since 2026-09-24: the Keyboard pair's event names ('ios' twice,
    // keyboardWill/DidShow, keyboardWill/DidHide) leave with it (Orca #22252).
    // 674 since 2026-09-25: the Markdown actions' 'web' check (Orca #22362).
    // 682 since 2026-09-26: the readers' copy with the desktop's reason.
    // 681 since the same day: the reader's 'Read only' gives way to the reason.
    // 676 since 2026-09-26 (later): FileReader's source view moved out of the family.
    // 677 since 2026-09-29: the header's 'connected' check for the badge's `watching`.
    // 675 since 2026-09-30: 'default' and 'manual' moved to shownPermissionMode.
    // 671 since 2026-09-30 (later): the live terminal dictation's 'pty' and three '' moved to
    // live-terminal-dictation.ts (see HEAD_RUNTIME_STRING_SHA256).
    // 670 since 2026-10-04: the tab pill's 'idle' moved to session-tab-activity.ts.
    // 671 since 2026-10-06: the 'file' check before a closed file tab's document is released (Orca #24655).
    expect(strings).toHaveLength(671)
    expect(hash(strings)).toBe(HEAD_RUNTIME_STRING_SHA256)
    const jsx = readJsxFacts(readDefinitions())
    // 95 since 2026-09-15: the markdown preview's own host element.
    // 99 since 2026-09-15 (later): the .md tab's Preview/Edit toggle — its bar,
    // the two pressables it maps, and the preview's own scroller.
    // 97 since 2026-09-26: the old reader's View and FlatList moved out with it.
    expect(jsx.host).toHaveLength(97)
    expect(hash(jsx.host)).toBe(HEAD_HOST_JSX_SHA256)
    // 69 since 2026-09-15: the markdown preview's own leaf element.
    // 71 since 2026-09-15 (later): the .md tab's Preview/Edit toggle — the icon
    // and the label inside each of the two pressables fold to two leaf records.
    // 72 since 2026-09-18: the file reader's line-selection action bar.
    // 73 since 2026-09-18 (later): the subagent transcript modal mounted by the
    // session content.
    // 74 since 2026-09-25: the surface mounts MobileFileTapMatchPicker, the
    // drawer a bare chat file name found in several folders is offered in.
    // 73 since 2026-09-26: its row and action bar out, MobileSessionFileSource in.
    // Same leaf record COUNT (73) since 2026-09-27 (theme sweep): several leaf icon `color` props
    // moved from the static `mobile-theme` palette to the live `colors` (e.g. `colors.textPrimary`
    // -> `colors.text`), so their captured expressions changed without changing the count.
    expect(jsx.leaf).toHaveLength(73)
    expect(hash(jsx.leaf)).toBe(HEAD_LEAF_JSX_SHA256)
    // 92 since 2026-09-15: the markdown preview's own style reference.
    // 85 since 2026-09-26: its seven style references moved out with it.
    expect(jsx.styleReferences).toHaveLength(85)
    expect(hash(jsx.styleReferences)).toBe(HEAD_STYLE_REFERENCE_SHA256)
  })
})
