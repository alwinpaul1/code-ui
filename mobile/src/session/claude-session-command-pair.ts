import { isTextBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'

/**
 * What a Claude session itself said about its model and effort through `/model`
 * and `/effort`: the latest of each, read from the `<local-command-stdout>`
 * rows the transcript already holds (Orca's reader publishes them).
 *
 * This is the SESSION'S OWN word, not the settings file's and not a guess:
 * Claude Code prints what it set, "for this session only" included, which no
 * settings file records. It sits below the live beacon and the on-screen
 * badge, which state the pair on every repaint, and above nothing else. See
 * `docs/mobile-agent-hud.md` ("Model and effort without a beacon").
 *
 * Wordings were read from the Claude Code 2.1.289 binary (strings, 2026-10-05)
 * and the `Set model to` / `Set effort level to` shapes from rows captured on
 * 2.1.278; the rest are MODELLED, not captured from a live session:
 *  - `Set model to \`X\`` + (` and saved as your default for new sessions` |
 *    ` for this session only`) + optional ` with <level> effort`
 *  - `Kept model as \`X\``
 *  - `Set effort level to <level> (<where saved>): <description>`
 *  - `Effort '<asked>' exceeds the cap for <model> …; set to '<level>' instead`
 *  - `Current effort level: <level> (<description>)`
 *  - `Effort level: auto (currently <level>)`
 *  - `Effort level set to auto …`: the level is not stated, so effort is null
 *  - `CLAUDE_CODE_EFFORT_LEVEL=<level> overrides this session …`
 *  - `… Effort stays <level>.` (Ultracode)
 *
 * A `/model` switch resets the effort to what its own output states, or to
 * null: the effort belongs to the model before it, and carrying it over is how
 * "Opus Medium" came to be drawn on an Opus xhigh session (2026-09-15).
 */
export type SessionCommandPair = {
  /** The model the latest `/model` named, as Claude spells it ("Opus 5.5"). */
  label: string | null
  effort: string | null
}

const LEVEL = '(low|medium|high|xhigh|max)'
const STDOUT = /^\s*<local-command-stdout>([\s\S]*?)<\/local-command-stdout>\s*$/
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g

const SET_MODEL = /^Set model to `([^`]+)`/
const KEPT_MODEL = /^Kept model as `([^`]+)`/
const WITH_EFFORT = new RegExp(`\\bwith ${LEVEL} effort\\b`)
const EFFORT_RULES: readonly RegExp[] = [
  new RegExp(`^Set effort level to ${LEVEL}\\b`),
  new RegExp(`^Effort '[^']*' exceeds the cap[^;]*; set to '${LEVEL}' instead`),
  new RegExp(`^Current effort level: ${LEVEL}\\b`),
  new RegExp(`^Effort level: auto \\(currently ${LEVEL}\\b`),
  new RegExp(`^CLAUDE_CODE_EFFORT_LEVEL=${LEVEL}\\b.*overrides this session`),
  new RegExp(`\\bEffort stays ${LEVEL}\\b`)
]
const EFFORT_AUTO = /^Effort level set to auto\b/

export function sessionCommandPair(messages: readonly NativeChatMessage[]): SessionCommandPair | null {
  let pair = null as SessionCommandPair | null
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'system') {
      continue
    }
    const raw = message.blocks.filter(isTextBlock).map((block) => block.text).join('')
    const body = STDOUT.exec(raw)?.[1]?.replace(ANSI, '').trim()
    if (!body) {
      continue
    }
    const model = SET_MODEL.exec(body)?.[1] ?? KEPT_MODEL.exec(body)?.[1]
    if (model) {
      const named = model.trim()
      // "Kept model as" changes nothing, so the effort stands with the model.
      const kept: boolean = KEPT_MODEL.test(body) && pair?.label === named
      pair = { label: named, effort: WITH_EFFORT.exec(body)?.[1] ?? (kept ? pair!.effort : null) }
      continue
    }
    const effort = EFFORT_RULES.map((rule) => rule.exec(body)?.[1]).find((level) => level !== undefined)
    if (effort) {
      pair = { label: pair?.label ?? null, effort }
    } else if (EFFORT_AUTO.test(body)) {
      pair = { label: pair?.label ?? null, effort: null }
    }
  }
  return pair
}
