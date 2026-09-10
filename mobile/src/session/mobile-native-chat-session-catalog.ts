// What the composer's `/` menu offers for one chat.
//
// Why: the curated per-agent catalog plus the host's disk scan of skill roots is
// not what the running session can do. A structured session reports its own `/`
// surface — this repo's `.claude/commands`, the skills that only reach it
// through plugin roots, and none of the commands the CLI reserves for its
// terminal UI. When that report is present it is the authority on WHICH names
// exist; the scan stays the source of description and scope for the names both
// know about. A host that predates the report leaves `sessionCommands`
// undefined and the menu is exactly what it was.

import type { AgentSessionConversationCommand } from '../../../src/shared/agent-session-conversation-command'
import type { AgentSessionSlashCommand } from '../../../src/shared/agent-session-wire'
import { structuredSlashCommands } from '../../../src/shared/structured-agent-session-composer'
import {
  getNativeChatAgentProfile,
  getVerifiedNativeChatCommands
} from '../../../src/shared/native-chat-agent-profiles'
import {
  sessionReportedSkillNames,
  sessionSlashCommandSuggestions,
  type SlashCommandSuggestion
} from '../../../src/shared/native-chat-slash-commands'
import type { DiscoveredSkill } from '../../../src/shared/skills'
import {
  rankSkillSuggestions,
  rankSlashCommandSuggestions
} from './mobile-native-chat-autocomplete'
import type { ComposerSuggestion } from './MobileNativeChatComposerSuggestions'
import {
  filterNativeChatSkillsForAgent,
  nativeChatSkillCommandName
} from './mobile-native-chat-skill-command'

/** Enough for any catalog plus every installed skill; the list virtualizes. */
const SLASH_MENU_LIMIT = 500

export type MobileNativeChatSlashCatalog = {
  commands: readonly SlashCommandSuggestion[]
  skills: readonly DiscoveredSkill[]
}

/** A skill the session says it loaded but this host's scan cannot locate. It is
 *  real and invocable, so it is offered; it carries no description or scope, so
 *  it sorts after the located ones and wears the neutral "Skill" badge.
 *  `sourceKind: 'home'` also keeps `nativeChatSkillCommandName` from re-deriving
 *  a plugin prefix — the reported name IS the dispatch token. */
function unlocatedSkill(name: string): DiscoveredSkill {
  return {
    id: `session:${name}`,
    name,
    description: null,
    providers: [],
    sourceKind: 'home',
    sourceLabel: '',
    rootPath: '',
    directoryPath: '',
    skillFilePath: '',
    installed: true,
    updatedAt: null
  }
}

export function mobileNativeChatSlashCatalog(args: {
  agent: string | null
  /** Skills the host found by scanning disk. */
  scannedSkills: readonly DiscoveredSkill[]
  /** The `/` surface the running structured session reports. Undefined keeps the
   *  curated catalog and the disk scan — the PTY lane and older hosts. */
  sessionCommands?: readonly AgentSessionSlashCommand[]
  /** Conversation commands this chat host supports. Defined only on the
   *  structured lane, whose menu must be strictly what the dispatcher honors —
   *  a chat session cannot open a TUI overlay, so offering `/vim` only earns a
   *  "not available in chat sessions". */
  conversationCommands?: readonly AgentSessionConversationCommand[]
}): MobileNativeChatSlashCatalog {
  const { agent, conversationCommands, scannedSkills, sessionCommands } = args
  const scanned = filterNativeChatSkillsForAgent(scannedSkills, agent)
  if (sessionCommands === undefined) {
    if (conversationCommands !== undefined) {
      return { commands: structuredSlashCommands(conversationCommands), skills: scanned }
    }
    return { commands: agent ? getVerifiedNativeChatCommands(agent) : [], skills: scanned }
  }
  const byToken = new Map<string, DiscoveredSkill>()
  for (const skill of scanned) {
    const token = nativeChatSkillCommandName(skill)
    if (token && !byToken.has(token)) {
      byToken.set(token, skill)
    }
  }
  // A provider that names a `/` entry without saying whether it is a command or
  // a skill lands in both lists; the scan breaks the tie when it knows the name.
  const unclassified = new Set(
    sessionCommands.filter((entry) => entry.kindUnspecified).map((entry) => entry.name)
  )
  const skillNames: string[] = [
    ...sessionReportedSkillNames(sessionCommands),
    ...[...byToken.keys()].filter((token) => unclassified.has(token))
  ]
  const skillNameSet = new Set(skillNames)
  const commands = (agent ? sessionSlashCommandSuggestions(agent, sessionCommands) : []).filter(
    (command) => !(command.kindUnspecified && skillNameSet.has(command.name))
  )
  const located: DiscoveredSkill[] = []
  const unlocated: DiscoveredSkill[] = []
  for (const name of new Set(skillNames)) {
    const found = byToken.get(name)
    if (found) {
      located.push(found)
    } else {
      unlocated.push(unlocatedSkill(name))
    }
  }
  return { commands, skills: [...located, ...unlocated] }
}

/** The composer's `/` rows for a query: commands first, then skills. A bare `/`
 *  lists everything the terminal would; the row list virtualizes, so the size
 *  of the catalog is not a render cost. */
export function mobileNativeChatSlashSuggestions(args: {
  agent: string | null
  scannedSkills: readonly DiscoveredSkill[]
  sessionCommands: readonly AgentSessionSlashCommand[] | undefined
  conversationCommands: readonly AgentSessionConversationCommand[] | undefined
  query: string
}): ComposerSuggestion[] {
  const { agent, query } = args
  const catalog = mobileNativeChatSlashCatalog(args)
  const commands: ComposerSuggestion[] = rankSlashCommandSuggestions(
    catalog.commands,
    query,
    SLASH_MENU_LIMIT
  ).map((command) => ({ kind: 'command', command }))
  // For agents that invoke skills with `/`, a name already in the command list
  // is a command, not a skill (desktop picker parity); `$` agents keep both.
  const prefix = (agent ? getNativeChatAgentProfile(agent)?.skillPrefix : null) ?? '/'
  const named = new Set(catalog.commands.map((command) => command.name))
  const skills: ComposerSuggestion[] = rankSkillSuggestions(catalog.skills, query, SLASH_MENU_LIMIT)
    .filter((skill) => !(prefix === '/' && named.has(skill.name)))
    .map((skill) => ({ kind: 'skill', skill, prefix }))
  return [...commands, ...skills]
}
