import { describe, expect, it } from 'vitest'
import {
  maskedMcpServerEnvLines,
  parseMcpConfig,
  serializeMcpConfig,
  type McpServerEntry
} from './mcp-config-parse'

describe('parsing .mcp.json', () => {
  it('reads a stdio server with args and env', () => {
    const result = parseMcpConfig(
      JSON.stringify({
        mcpServers: {
          local: { command: 'npx', args: ['-y', 'thing'], env: { API_KEY: 'secret-1' } }
        }
      })
    )
    expect(result).toEqual({
      ok: true,
      servers: [
        {
          name: 'local',
          config: { kind: 'stdio', command: 'npx', args: ['-y', 'thing'], env: { API_KEY: 'secret-1' } }
        }
      ]
    })
  })

  it('reads a remote server by url', () => {
    const result = parseMcpConfig(
      JSON.stringify({ mcpServers: { hosted: { url: 'https://example.com/mcp', type: 'sse' } } })
    )
    expect(result).toEqual({
      ok: true,
      servers: [{ name: 'hosted', config: { kind: 'remote', url: 'https://example.com/mcp', type: 'sse' } }]
    })
  })

  it('defaults a remote server with no type to http', () => {
    const result = parseMcpConfig(JSON.stringify({ mcpServers: { hosted: { url: 'https://x' } } }))
    expect(result.ok).toBe(true)
    expect(result.ok && result.servers[0]?.config).toMatchObject({ kind: 'remote', type: 'http' })
  })

  it('degenerate: zero servers reads as an empty, valid list', () => {
    expect(parseMcpConfig(JSON.stringify({ mcpServers: {} }))).toEqual({ ok: true, servers: [] })
  })

  it('degenerate: a missing mcpServers key reads as an empty list, not a shape error', () => {
    expect(parseMcpConfig(JSON.stringify({ inputs: [] }))).toEqual({ ok: true, servers: [] })
  })

  it('degenerate: an empty file reads as an empty list, not a syntax error', () => {
    expect(parseMcpConfig('')).toEqual({ ok: true, servers: [] })
  })

  it('degenerate: a whitespace-only file reads as an empty list', () => {
    expect(parseMcpConfig('   \n\t ')).toEqual({ ok: true, servers: [] })
  })

  it('refuses malformed JSON with a line number, using the host’s own wording for the shape', () => {
    const result = parseMcpConfig('{\n  "mcpServers": {\n')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.line).toBeGreaterThan(0)
  })

  it('refuses mcpServers that is an array instead of an object, with the host’s own message', () => {
    const result = parseMcpConfig(JSON.stringify({ mcpServers: [] }))
    expect(result).toEqual({
      ok: false,
      error: {
        line: null,
        column: null,
        message: '.mcp.json is malformed (not valid JSON, or mcpServers is not an object)'
      }
    })
  })

  it('drops a server entry that is neither a command nor a url, instead of crashing', () => {
    const result = parseMcpConfig(JSON.stringify({ mcpServers: { broken: { nonsense: true } } }))
    expect(result).toEqual({ ok: true, servers: [] })
  })
})

describe('serializing .mcp.json back', () => {
  it('round-trips a stdio server', () => {
    const servers: McpServerEntry[] = [
      { name: 'local', config: { kind: 'stdio', command: 'npx', args: ['-y', 'x'], env: { A: '1' } } }
    ]
    const text = serializeMcpConfig(servers)
    expect(parseMcpConfig(text)).toEqual({ ok: true, servers })
  })

  it('round-trips a remote server', () => {
    const servers: McpServerEntry[] = [
      { name: 'hosted', config: { kind: 'remote', url: 'https://x', type: 'sse' } }
    ]
    expect(parseMcpConfig(serializeMcpConfig(servers))).toEqual({ ok: true, servers })
  })

  it('degenerate: serializes zero servers to a valid, parseable file', () => {
    const text = serializeMcpConfig([])
    expect(text).toContain('"mcpServers"')
    expect(parseMcpConfig(text)).toEqual({ ok: true, servers: [] })
  })

  it('omits args and env entirely when there are none, rather than writing empty ones', () => {
    const text = serializeMcpConfig([
      { name: 'bare', config: { kind: 'stdio', command: 'npx', args: [], env: {} } }
    ])
    expect(text).not.toContain('"args"')
    expect(text).not.toContain('"env"')
  })
})

describe('masking an MCP server’s env for the collapsed list row', () => {
  it('shows the key and never the value', () => {
    const lines = maskedMcpServerEnvLines({
      kind: 'stdio',
      command: 'npx',
      args: [],
      env: { API_KEY: 'sk-super-secret-value' }
    })
    expect(lines).toEqual(['API_KEY=<set>'])
    expect(lines.join(' ')).not.toContain('sk-super-secret-value')
  })

  it('degenerate: a stdio server with no env masks to no lines', () => {
    expect(maskedMcpServerEnvLines({ kind: 'stdio', command: 'npx', args: [], env: {} })).toEqual([])
  })

  it('a remote server has no env to mask', () => {
    expect(maskedMcpServerEnvLines({ kind: 'remote', url: 'https://x', type: 'http' })).toEqual([])
  })
})
