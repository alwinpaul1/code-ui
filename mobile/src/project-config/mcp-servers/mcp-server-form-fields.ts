import type { McpServerEntry } from './mcp-config-parse'

/** The add/edit form's field state, and the pure conversions to and from a
 *  parsed `McpServerEntry` — kept apart from MobileMcpServersPanel.tsx so the
 *  parsing rules (how "args" and "env" text areas turn into arrays/objects)
 *  are unit-testable without rendering anything. */
export type McpServerFormState = {
  name: string
  isRemote: boolean
  command: string
  argsText: string
  envText: string
  url: string
  remoteType: 'http' | 'sse'
}

export const EMPTY_MCP_SERVER_FORM: McpServerFormState = {
  name: '',
  isRemote: false,
  command: '',
  argsText: '',
  envText: '',
  url: '',
  remoteType: 'http'
}

export function mcpServerFormForEntry(entry: McpServerEntry): McpServerFormState {
  if (entry.config.kind === 'remote') {
    return {
      ...EMPTY_MCP_SERVER_FORM,
      name: entry.name,
      isRemote: true,
      url: entry.config.url,
      remoteType: entry.config.type
    }
  }
  return {
    ...EMPTY_MCP_SERVER_FORM,
    name: entry.name,
    isRemote: false,
    command: entry.config.command,
    argsText: entry.config.args.join(' '),
    envText: Object.entries(entry.config.env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')
  }
}

function parseArgsText(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

function parseEnvText(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=')
    if (eq <= 0) {
      continue
    }
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key) {
      env[key] = value
    }
  }
  return env
}

/** Null when the form does not describe a valid server yet — a blank name,
 *  or a remote server with no URL, or a command server with no command. */
export function mcpServerEntryFromForm(form: McpServerFormState): McpServerEntry | null {
  const name = form.name.trim()
  if (!name) {
    return null
  }
  if (form.isRemote) {
    const url = form.url.trim()
    return url ? { name, config: { kind: 'remote', url, type: form.remoteType } } : null
  }
  const command = form.command.trim()
  if (!command) {
    return null
  }
  return {
    name,
    config: { kind: 'stdio', command, args: parseArgsText(form.argsText), env: parseEnvText(form.envText) }
  }
}
