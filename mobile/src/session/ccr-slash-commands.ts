import type { AgentSessionSlashCommand } from '../../../src/shared/agent-session-wire'
import type { CcrEvent } from './ccr-session-api'

/**
 * The `/` menu of a Claude tab matched to its Anthropic session, as the Claude app builds it
 * (1.261013.20).
 *
 * The session states its own commands on the stream: a `system` event (`SdkSystemEvent`,
 * jau.java:22-28) carries `slash_commands`, `skills` and `terminal_slash_commands`, every one a
 * list of bare names. The app keeps the newest pair (su8.w4, su8.java:12121) and lists
 * `slash_commands`, then `focus` when the terminal-only list holds it, then its own commands
 * (iu7.java, the `hu7` case 0 list, made distinct). Claude Code 2.1.300 sent both lists on its
 * `init` event (probe p4, 2026-10-15: `slash_commands: ['academic-writer', …]`,
 * `terminal_slash_commands: ['doctor']`); the rest of `terminal_slash_commands` is for the
 * terminal and is not listed.
 *
 * The app's own commands (`unm`, iu7.a, ay8.java:8650) open a phone sheet and are never sent:
 * `/model` the model picker ("Choose a model", `ccr_slash_model_description`), `/diff` the
 * changes, `/workflows` Background tasks (neither has a description, tw30.java:1093-1110).
 * `/feedback`, `/bug` and `/export` are the app's too, but open Anthropic's own flows, which
 * Code UI has no counterpart for, so they are left off.
 *
 * Null when no event states the list (a session that predates it, or a stream not read yet):
 * the menu keeps the curated catalog then.
 */
export type ClaudeAppCommand = 'model' | 'diff' | 'workflows'

/** In the app's order (`unm`): an empty description keeps the curated catalog's text off a row
 *  the app draws without one (sessionSlashCommandSuggestions reads `??`). */
const APP_COMMANDS: readonly AgentSessionSlashCommand[] = Object.freeze([
  { name: 'workflows', kind: 'command', description: '' },
  { name: 'diff', kind: 'command', description: '' },
  { name: 'model', kind: 'command', description: 'Choose a model' }
])

const cache = new WeakMap<Record<string, unknown>, readonly AgentSessionSlashCommand[]>()

function names(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  return value.flatMap((entry) => {
    const name = typeof entry === 'string' ? entry.trim().replace(/^\//, '') : ''
    return name ? [name] : []
  })
}

/** The newest top-level `system` event that states `slash_commands` as a list, or null. */
function newestStatement(events: readonly CcrEvent[]): Record<string, unknown> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = events[index]!.payload
    if (payload.type === 'system' && !payload.parent_tool_use_id && Array.isArray(payload.slash_commands)) {
      return payload
    }
  }
  return null
}

/** The session's `/` surface, the same array for the same statement (the menu memoises on it). */
export function ccrSessionSlashCommands(events: readonly CcrEvent[]): readonly AgentSessionSlashCommand[] | undefined {
  const statement = newestStatement(events)
  if (!statement) {
    return undefined
  }
  const kept = cache.get(statement)
  if (kept) {
    return kept
  }
  const skills = new Set(names(statement.skills) ?? [])
  const listed = names(statement.slash_commands) ?? []
  const focus = (names(statement.terminal_slash_commands) ?? []).includes('focus') ? ['focus'] : []
  const seen = new Set<string>()
  const commands: AgentSessionSlashCommand[] = []
  for (const name of [...listed, ...focus]) {
    if (!seen.has(name)) {
      seen.add(name)
      commands.push({ name, kind: skills.has(name) ? 'skill' : 'command' })
    }
  }
  for (const own of APP_COMMANDS) {
    const at = commands.findIndex((command) => command.name === own.name)
    if (at === -1) {
      commands.push(own)
    } else {
      commands[at] = own
    }
  }
  const frozen = Object.freeze(commands)
  cache.set(statement, frozen)
  return frozen
}

/** The app command a send is, or null: the bare `/name` alone (iu7.a refuses one with words
 *  after it unless the command takes them, and none of these three does). */
export function claudeAppCommandOf(text: string): ClaudeAppCommand | null {
  const match = /^\s*\/(model|diff|workflows)\s*$/.exec(text)
  return match ? (match[1] as ClaudeAppCommand) : null
}
