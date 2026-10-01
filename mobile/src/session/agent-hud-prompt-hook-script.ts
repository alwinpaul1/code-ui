import { AGENT_HUD_TTY_WRITE, ENCODE_FN } from './agent-hud-tty-write'

// The prompt hook's sh script. Moved out of agent-hud-launch-args.ts, which
// holds the other emitters and sits at its line cap; the constant is
// re-exported from there, so every import of it keeps working.

/**
 * What the user typed on the DESKTOP, beaconed the moment they submit it.
 *
 * Why this exists: Claude Code records a prompt sent while a turn is running
 * as an `attachment`/`queued_command`, and Orca's transcript reader drops
 * those, so the phone never learns the message exists — the desk and the
 * phone show different conversations (2026-09-13). The agent's own hook is
 * the one place the text is available without touching the user's machine.
 *
 * `$$` is the hook process id: it makes two identical prompts distinct, so
 * the phone can tell a repeat from a re-beacon of the same one.
 *
 * The hook must print NOTHING on stdout: for UserPromptSubmit, Claude Code
 * feeds a hook's stdout back into the model as context.
 */
export const CLAUDE_HUD_PROMPT_HOOK_SCRIPT = [
  'i=$(cat 2>/dev/null || true)',
  'g(){ printf %s "$i" | LC_ALL=C sed -nE "s/.*$1.*/\\1/p"; }',
  ENCODE_FN,
  // JSON-escaped, so the value is one line and any quote inside it is \".
  'pr=$(g "\\"prompt\\":\\"(([^\\"\\\\\\\\]|\\\\\\\\.)*)\\"")',
  'pf=$(printf %s "$pr" | awk "{print substr(\\$0,1,2000)}")',
  // `cut=1` when the text was shortened: the phone matched a long prompt to
  // its transcript row by guessing at the cut length, and the guess was wrong
  // whenever escapes or multibyte text moved the boundary (2026-09-13).
  'ct=""',
  '[ "$pf" != "$pr" ] && ct=" cut=1"',
  'pr="$pf"',
  // `at=<uuid>`: the transcript's last user/assistant row AT THE MOMENT of
  // submit. A prompt queued while a turn runs is never projected as a row of
  // its own, so the phone draws it from this beacon — and used to anchor it to
  // whatever its tail was when the beacon ARRIVED. On a lagging link that was
  // several turns late, so the message landed far below where the Claude app
  // (which reads the record in place) shows it (2026-09-14). Capturing the
  // anchor here, at the source, makes the position independent of arrival.
  // A row type is NOT enough. Claude writes tool calls, tool results and
  // thinking as `user`/`assistant` rows too. On 2026-09-15 anchors on them were
  // not found on the phone: the lookup failed, and every queued prompt of a
  // turn fell back to the arrival tail and stacked at the bottom under its own
  // replies (device screenshots; a live 2.1.270 transcript whose last six rows
  // were tool_use, tool_result, tool_use, tool_result, thinking, text). So
  // only text rows anchor.
  // That day's reason, that Orca projects none of them, is not what Orca
  // 1.4.216 does: its transcript decoder (`rEn`/`KTn` in app.asar, read
  // 2026-09-29) makes a row of each, keyed by the record uuid, with tool calls
  // and results as tool rows and thinking as text. The exclusion is kept
  // anyway. A text row is held whichever reading is right, while a tool-row
  // anchor is found only if those rows reach the phone under that uuid, which
  // no device has shown since the report above, and changing it moves every
  // mid-turn desk message. It cost this: a message typed after a call, with
  // no text since, drew above that call (usually one), where the Claude app
  // draws it below. Since 2026-09-29 the hook also says when it ran (`ts=`,
  // below), and the phone moves the message below the rows stamped a second
  // before the start of that second, so only a call within about two seconds
  // of the send, or a tab whose hook sends no time, still pays it. See
  // docs/mobile-agent-hud.md, "Beacon field `at`".
  // A row is skipped by its content block's `"type":`, never by the word
  // alone. Claude Code 2.1.284 writes the message's `"stop_reason":"tool_use"`
  // into every record of a turn that goes on to call a tool, text records
  // included, so a filter on a bare `"tool_use"` skipped every text row of a
  // working turn and named the prompt that opened it: 05:08 for a message
  // typed at 05:36, right after a text row (2026-09-29). Words that quote a
  // type are escaped in the JSON (`\"type\":\"tool_use\"`), so they do not match.
  // And a row must carry something Orca draws: a string prompt, or a text or
  // image block. Orca 1.4.216's decoder draws nothing for a record of only
  // redacted_thinking, server_tool_use or web_search_tool_result, which the
  // bare-word rule skipped only by the accident of their stop reason.
  'tp=$(g "\\"transcript_path\\":\\"([^\\"]*)\\"")',
  // Same as the status line: a Windows path arrives JSON-escaped with
  // backslashes, which Git Bash cannot open; slashes work on every platform.
  '[ -n "$tp" ] && tp=$(printf %s "$tp" | tr "\\\\\\\\" /)',
  '[ -n "$tp" ] && [ -r "$tp" ] && at=$(tail -c 1048576 "$tp" 2>/dev/null | grep -E "\\"type\\":\\"(user|assistant)\\"" 2>/dev/null | grep -E "\\"role\\":\\"user\\",\\"content\\":\\"|\\"type\\":\\"(text|image)\\"" 2>/dev/null | grep -v -E "\\"type\\":\\"(tool_use|tool_result|thinking)\\"" 2>/dev/null | tail -n 1 | grep -o "\\"uuid\\":\\"[0-9a-fA-F-]*\\"" 2>/dev/null | head -n 1 | sed -e "s/.*\\"uuid\\":\\"//" -e "s/\\"$//")',
  // `sc=1`: this prompt is a loop's tick, not something typed. Claude Code
  // fires a CronCreate prompt through this same hook with nothing in the
  // payload that says so (2.1.286), and the chat drew every tick as a user
  // bubble (2026-10-01). Just before it enqueues the prompt it writes a
  // `"subtype":"scheduled_task_fire"` row whose `prompt` is the tick's first
  // 200 characters, uncut-marked; a row like that among the last eight lines
  // with this very prompt (escaped as both are) is the mark: the same words,
  // or, when the row's words are 200 characters (escapes decoded, a multibyte
  // character counted once; Claude Code cuts by UTF-16 units, so a cut prompt
  // holding an emoji counts under 200 and gets no mark, the safe side), a
  // prefix of them. A shorter row is the whole
  // prompt, and a prefix rule there marked a typed "status report…" as a tick
  // of a loop whose prompt was "status" (review of 8233ed8b). Compared with the
  // copy cut at 2,000 bytes, which holds any 200 characters' escaping. Quoted
  // in the `case`, so a `*` or `[` in the words is a character, not a pattern.
  // A write that lands after this read leaves no mark, never a wrong one.
  'sp=""; sc=""',
  '[ -n "$tp" ] && [ -r "$tp" ] && sp=$(tail -n 8 "$tp" 2>/dev/null | grep "\\"subtype\\":\\"scheduled_task_fire\\"" 2>/dev/null | tail -n 1 | LC_ALL=C sed -nE "s/.*\\"prompt\\":\\"(([^\\"\\\\\\\\]|\\\\\\\\.)*)\\".*/\\\\1/p"); n=$(printf %s "$sp" | LC_ALL=C sed -e "s/\\\\\\\\u[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]/u/g" -e "s/\\\\\\\\./e/g" | LC_ALL=C tr -d "\\\\200-\\\\277" | wc -c | tr -d " "); [ -n "$sp" ] && { [ "$pr" = "$sp" ] || { [ "${n:-0}" -ge 200 ] && case "$pr" in "$sp"*) true;; *) false;; esac; }; } && sc=" sc=1"',
  // `sid`, ahead of `up=`: the session this prompt was typed into, so a later
  // session in the same terminal does not echo it (see the status line).
  'si=$(g "\\"session_id\\":\\"([A-Za-z0-9._-]+)\\"")',
  // `ts=`: the second this ran, by the desk clock, which stamps the
  // transcript's rows too. UserPromptSubmit fires at the enqueue (2.1.284: 21
  // ms after the Enter), so it is when the prompt was typed. It places a copy
  // whose `at=` row the phone does not hold: the rows on a page not loaded,
  // or a record Orca draws nothing for. Without it every such copy of a turn
  // read after a sleep settled under the same last reply, three in a row
  // (reported 2026-09-29). A `date` that cannot say `%s` sends no time.
  'ts=$(date +%s 2>/dev/null)',
  'case "$ts" in ""|*[!0-9]*) ts="";; esac',
  'o="CUIHUD1 agent=claude${si:+ sid=$si} up=$$:$(q "$pr")$ct$sc${at:+ at=$at}${ts:+ ts=$ts}"',
  '[ -z "$pr" ] && exit 0',
  ...AGENT_HUD_TTY_WRITE,
  // Claude Code treats ANY stdout from a UserPromptSubmit hook as context,
  // and a non-zero exit as a hook error (issue #13912, 2026). This script
  // prints nothing and always succeeds, whatever the tty write did.
  'exit 0'
].join('; ')
