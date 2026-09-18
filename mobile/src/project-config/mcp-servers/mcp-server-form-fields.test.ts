import { describe, expect, it } from 'vitest'
import {
  EMPTY_MCP_SERVER_FORM,
  mcpServerEntryFromForm,
  mcpServerFormForEntry
} from './mcp-server-form-fields'
import type { McpServerEntry } from './mcp-config-parse'

describe('the MCP server add/edit form fields', () => {
  it('round-trips a stdio entry through the form', () => {
    const entry: McpServerEntry = {
      name: 'local',
      config: { kind: 'stdio', command: 'npx', args: ['-y', 'x'], env: { API_KEY: 'sk-1' } }
    }
    const form = mcpServerFormForEntry(entry)
    expect(mcpServerEntryFromForm(form)).toEqual(entry)
  })

  it('round-trips a remote entry through the form', () => {
    const entry: McpServerEntry = { name: 'hosted', config: { kind: 'remote', url: 'https://x', type: 'sse' } }
    expect(mcpServerEntryFromForm(mcpServerFormForEntry(entry))).toEqual(entry)
  })

  it('splits an args line on whitespace, dropping extra spaces', () => {
    const entry = mcpServerEntryFromForm({
      ...EMPTY_MCP_SERVER_FORM,
      name: 'a',
      command: 'npx',
      argsText: '  -y   thing  '
    })
    expect(entry?.config).toMatchObject({ args: ['-y', 'thing'] })
  })

  it('parses one KEY=VALUE per line, and a value may itself contain "="', () => {
    const entry = mcpServerEntryFromForm({
      ...EMPTY_MCP_SERVER_FORM,
      name: 'a',
      command: 'npx',
      envText: 'API_KEY=sk-abc=123\nOTHER=1'
    })
    expect(entry?.config).toMatchObject({ env: { API_KEY: 'sk-abc=123', OTHER: '1' } })
  })

  it('degenerate: a blank env text area yields no env entries', () => {
    const entry = mcpServerEntryFromForm({ ...EMPTY_MCP_SERVER_FORM, name: 'a', command: 'npx', envText: '' })
    expect(entry?.config).toMatchObject({ env: {} })
  })

  it('ignores an env line with no "="', () => {
    const entry = mcpServerEntryFromForm({
      ...EMPTY_MCP_SERVER_FORM,
      name: 'a',
      command: 'npx',
      envText: 'not-a-pair\nA=1'
    })
    expect(entry?.config).toMatchObject({ env: { A: '1' } })
  })

  it('refuses a blank name', () => {
    expect(mcpServerEntryFromForm({ ...EMPTY_MCP_SERVER_FORM, name: '  ', command: 'npx' })).toBeNull()
  })

  it('refuses a command-kind form with no command', () => {
    expect(mcpServerEntryFromForm({ ...EMPTY_MCP_SERVER_FORM, name: 'a' })).toBeNull()
  })

  it('refuses a remote-kind form with no URL', () => {
    expect(mcpServerEntryFromForm({ ...EMPTY_MCP_SERVER_FORM, name: 'a', isRemote: true })).toBeNull()
  })
})
