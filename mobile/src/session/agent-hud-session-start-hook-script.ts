import { AGENT_HUD_TTY_WRITE, ENCODE_FN } from './agent-hud-tty-write'

/**
 * The model a Claude Code session started on, beaconed at `SessionStart`.
 *
 * Why: the status line says model and effort on every repaint, but only while
 * it is mounted and only after its first tick, and a session that never gets
 * one (a tab whose workspace is not trusted skips the status line AND hooks
 * alike, so this does not cover that case) had no model until its first turn.
 * `SessionStart` is the one hook input that names the model: Claude Code
 * 2.1.289 builds it as `{...rd(session, cwd), hook_event_name:"SessionStart",
 * source, agent_type, model, session_title}`, and `rd` adds `effort` only when
 * it is handed a tool context, which this call is not. So the effort of a
 * session comes from its Stop hook (agent-hud-launch-args.ts), whose input is
 * built with one. Read from the 2.1.289 binary, not captured from a live
 * session.
 *
 * The id is cut at its first character outside `[A-Za-z0-9._-]`: a
 * `claude-opus-5-5[1m]` window marker is not part of the id the status line
 * reports, and the phone matches ids by equality.
 *
 * Prints NOTHING on stdout: a SessionStart hook's stdout is added to the
 * model's context. Says nothing when the input names no model.
 */
function modelFrameHook(key: string): string {
  return [
    'i=$(cat 2>/dev/null || true)',
    'g(){ printf %s "$i" | LC_ALL=C sed -nE "s/.*$1.*/\\1/p" | head -n 1; }',
    ENCODE_FN,
    // Only a Claude id: an alias ("opus") is not an id the phone can match, and
    // the status line names the model within a beat.
    `md=$(g "\\"${key}\\":\\"(claude-[A-Za-z0-9._-]+)")`,
    '[ -n "$md" ] || exit 0',
    'si=$(g "\\"session_id\\":\\"([A-Za-z0-9._-]+)\\"")',
    'o="CUIHUD1 agent=claude${si:+ sid=$si} model=$md"',
    ...AGENT_HUD_TTY_WRITE,
    // Whatever the write did: a hook that exits non-zero is a hook error.
    'exit 0'
  ].join('; ')
}

export const CLAUDE_HUD_SESSION_START_HOOK_SCRIPT = modelFrameHook('model')

/**
 * The model a session switched to, beaconed at `PostModelSwitch`.
 *
 * Claude Code 2.1.289 fires it after ANY change of the effective model (it
 * compares the model before and after every state update): a typed `/model`,
 * the picker, the SDK, a `/fast` promotion or an overload fallback (`source:
 * "auto"`), a resume. Its input is `{...rd(session, cwd), hook_event_name,
 * from_model, to_model, requested_model, source, context_tokens, …}`, with no
 * `effort` (`rd` is given no tool context). So a switch reaches the phone as
 * soon as it lands, without waiting for the next prompt or the status line's
 * next repaint, and the effort of the model before it is dropped at once
 * (`pairFromHookFrame`), to be re-learned from the status line or the next Stop.
 * Read from the binary (`GHr`, schema `lK`), not captured from a live session.
 * No hook fires for an effort-only change: the status line repaints on it
 * (`effortValue` is one of its inputs), and the next Stop reports it.
 *
 * Prints nothing on stdout, for the same reason as the SessionStart hook.
 */
export const CLAUDE_HUD_MODEL_SWITCH_HOOK_SCRIPT = modelFrameHook('to_model')
