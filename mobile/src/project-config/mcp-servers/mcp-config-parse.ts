import { locateJsonError } from '../project-config-json-locate-error'

/**
 * `.mcp.json`'s `mcpServers` map, parsed into an ordered list the screen can
 * render, add to, edit and remove from — and serialized back the way the
 * file already looks (2-space indent, `mcpServers` as an object keyed by
 * server name, matching the shape Claude Code itself writes with `claude mcp
 * add-json`).
 */
export type McpStdioServerConfig = {
  kind: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
}

export type McpRemoteServerConfig = {
  kind: 'remote'
  url: string
  type: 'sse' | 'http'
}

export type McpServerConfig = McpStdioServerConfig | McpRemoteServerConfig

export type McpServerEntry = {
  name: string
  config: McpServerConfig
}

export type McpConfigError = {
  line: number | null
  column: number | null
  message: string
}

export type McpConfigParseResult =
  | { ok: true; servers: McpServerEntry[] }
  | { ok: false; error: McpConfigError }

/** The host's own wording for this exact shape failure (`.mcp.json is
 *  malformed (not valid JSON, or mcpServers is not an object)`, read from the
 *  1.4.205 bundle) — reused here so a shape error reads the same as it would
 *  from the CLI itself. */
const MCP_SERVERS_NOT_OBJECT_MESSAGE =
  '.mcp.json is malformed (not valid JSON, or mcpServers is not an object)'

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((v): v is string => typeof v === 'string')
}

function toEnvRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const out: Record<string, string> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') {
      out[key] = v
    }
  }
  return out
}

function parseServerConfig(raw: unknown): McpServerConfig | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.url === 'string' && obj.url.length > 0) {
    const type = obj.type === 'sse' ? 'sse' : 'http'
    return { kind: 'remote', url: obj.url, type }
  }
  if (typeof obj.command === 'string' && obj.command.length > 0) {
    return {
      kind: 'stdio',
      command: obj.command,
      args: toStringArray(obj.args),
      env: toEnvRecord(obj.env)
    }
  }
  return null
}

export function parseMcpConfig(source: string): McpConfigParseResult {
  const trimmed = source.trim()
  if (trimmed.length === 0) {
    // Degenerate: an empty/whitespace-only file. Treated the same as a
    // missing file elsewhere (zero servers), not as a parse error — an
    // empty `.mcp.json` is not itself invalid JSON syntax to report a line
    // number for.
    return { ok: true, servers: [] }
  }
  const syntaxError = locateJsonError(trimmed)
  if (syntaxError) {
    return { ok: false, error: syntaxError }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    // locateJsonError agreed the text is valid JSON; JSON.parse should not
    // disagree. Refuse rather than guess if it somehow does.
    return {
      ok: false,
      error: { line: null, column: null, message: error instanceof Error ? error.message : String(error) }
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: { line: null, column: null, message: MCP_SERVERS_NOT_OBJECT_MESSAGE } }
  }
  const mcpServers = (parsed as Record<string, unknown>).mcpServers
  if (mcpServers === undefined) {
    // No `mcpServers` key at all: treated as zero servers rather than a
    // shape error, so a screen opened on a `.mcp.json` some other tool wrote
    // (e.g. only `{"inputs": …}`) still opens instead of refusing outright.
    return { ok: true, servers: [] }
  }
  if (typeof mcpServers !== 'object' || mcpServers === null || Array.isArray(mcpServers)) {
    return { ok: false, error: { line: null, column: null, message: MCP_SERVERS_NOT_OBJECT_MESSAGE } }
  }
  const servers: McpServerEntry[] = []
  for (const [name, raw] of Object.entries(mcpServers as Record<string, unknown>)) {
    const config = parseServerConfig(raw)
    if (config) {
      servers.push({ name, config })
    }
  }
  return { ok: true, servers }
}

/** Re-serializes the full list back to `.mcp.json` text, 2-space indent,
 *  preserving nothing else in the file — `.mcp.json` has no other top-level
 *  keys in practice, unlike `.claude/settings.json` (see
 *  permission-rules-parse.ts, which does preserve unrelated keys). */
export function serializeMcpConfig(servers: McpServerEntry[]): string {
  const mcpServers: Record<string, unknown> = {}
  for (const entry of servers) {
    mcpServers[entry.name] =
      entry.config.kind === 'remote'
        ? { url: entry.config.url, type: entry.config.type }
        : {
            command: entry.config.command,
            ...(entry.config.args.length > 0 ? { args: entry.config.args } : {}),
            ...(Object.keys(entry.config.env).length > 0 ? { env: entry.config.env } : {})
          }
  }
  return JSON.stringify({ mcpServers }, null, 2) + '\n'
}

/** The list row's masked env line: the key, never the value — "reveal only
 *  inside the edit field the user opened" (the edit form reads the real
 *  value straight off the parsed entry; this helper is for the collapsed
 *  row only). */
export function maskedMcpServerEnvLines(config: McpServerConfig): string[] {
  if (config.kind !== 'stdio') {
    return []
  }
  return Object.keys(config.env).map((key) => `${key}=<set>`)
}
