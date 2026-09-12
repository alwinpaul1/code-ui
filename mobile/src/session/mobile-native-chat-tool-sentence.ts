import { isToolCallBlock, isToolResultBlock, type NativeChatBlock } from '../../../src/shared/native-chat-types'

/**
 * One plain sentence for a run of tool calls, the way the Claude app puts it:
 * "Ran 3 commands, read a file", "Ran 12 commands (2 failed), read 6 files".
 * Requested on 2026-09-12 in place of "20× Bash cd … +17 more". Tool names
 * are grouped by what they did to the reader, not by the agent's vocabulary,
 * so Claude's `Bash` and Codex's `shell` both read as commands.
 */
type Kind = 'command' | 'read' | 'edit' | 'search' | 'agent' | 'web' | 'other'

const NOUN: Record<Kind, { verb: string; one: string; many: string }> = {
  command: { verb: 'ran', one: 'a command', many: 'commands' },
  read: { verb: 'read', one: 'a file', many: 'files' },
  edit: { verb: 'edited', one: 'a file', many: 'files' },
  search: { verb: 'searched', one: 'once', many: 'times' },
  agent: { verb: 'ran', one: 'an agent', many: 'agents' },
  web: { verb: 'fetched', one: 'a page', many: 'pages' },
  other: { verb: 'used', one: 'a tool', many: 'tools' }
}

const ORDER: Kind[] = ['command', 'read', 'edit', 'search', 'agent', 'web', 'other']

export function toolCallKind(name: string): Kind {
  const key = name.trim().toLowerCase().replace(/^.*[./]/, '')
  if (/^(bash|shell|exec|run_command|terminal|command|powershell)$/.test(key)) {
    return 'command'
  }
  if (/^(read|read_file|readfile|cat|view|notebookread)$/.test(key)) {
    return 'read'
  }
  if (/^(edit|write|multiedit|notebookedit|apply_patch|create_file|write_file|patch)$/.test(key)) {
    return 'edit'
  }
  if (/^(grep|glob|search|list|ls|find|rg|list_dir)$/.test(key)) {
    return 'search'
  }
  if (/^(agent|task|subagent|spawn_agent)$/.test(key)) {
    return 'agent'
  }
  if (/^(webfetch|websearch|fetch|browse|web_search|web_fetch)$/.test(key)) {
    return 'web'
  }
  return 'other'
}

export function toolRunSentence(blocks: readonly NativeChatBlock[]): string {
  const counts = new Map<Kind, { total: number; failed: number }>()
  const pending: Kind[] = []
  for (const block of blocks) {
    if (isToolCallBlock(block)) {
      const kind = toolCallKind(block.name)
      pending.push(kind)
      const entry = counts.get(kind) ?? { total: 0, failed: 0 }
      entry.total += 1
      counts.set(kind, entry)
    } else if (isToolResultBlock(block)) {
      // FIFO by ordinal, the pairing rule the fold itself uses.
      const kind = pending.shift()
      if (kind && block.isError) {
        counts.get(kind)!.failed += 1
      }
    }
  }
  const parts: string[] = []
  for (const kind of ORDER) {
    const entry = counts.get(kind)
    if (!entry) {
      continue
    }
    const noun = NOUN[kind]
    const amount = entry.total === 1 ? noun.one : `${entry.total} ${noun.many}`
    const failed = entry.failed > 0 ? ` (${entry.failed} failed)` : ''
    parts.push(`${noun.verb} ${amount}${failed}`)
  }
  if (parts.length === 0) {
    return ''
  }
  const sentence = parts.join(', ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}
