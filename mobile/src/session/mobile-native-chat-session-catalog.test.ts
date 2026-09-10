import { describe, expect, it } from 'vitest'
import type { DiscoveredSkill } from '../../../src/shared/skills'
import { mobileNativeChatSlashCatalog } from './mobile-native-chat-session-catalog'

function skill(overrides: Partial<DiscoveredSkill> & { name: string }): DiscoveredSkill {
  return {
    id: overrides.name,
    description: null,
    providers: ['claude'],
    sourceKind: 'home',
    sourceLabel: 'Skill',
    rootPath: '/home/.claude/skills',
    directoryPath: `/home/.claude/skills/${overrides.name}`,
    skillFilePath: `/home/.claude/skills/${overrides.name}/SKILL.md`,
    installed: true,
    updatedAt: null,
    ...overrides
  }
}

describe('the `/` menu of a session that reports its own command surface', () => {
  it('offers the commands the session loaded, not the curated guess', () => {
    const catalog = mobileNativeChatSlashCatalog({
      agent: 'claude',
      scannedSkills: [],
      sessionCommands: [
        { name: 'clear', kind: 'command' },
        // A repo command: only the session knows about `.claude/commands`.
        { name: 'opsx:apply', kind: 'command' }
      ]
    })
    expect(catalog.commands.map((command) => command.name)).toEqual(['clear', 'opsx:apply'])
    // `/compact` is in the curated catalog; this session never reported it.
    expect(catalog.commands.map((command) => command.name)).not.toContain('compact')
    // The curated catalog is still the description source for shared names.
    expect(catalog.commands[0]?.description).toBe('Start a new session with empty context')
  })

  it('offers a skill the session loaded that the host scan never saw', () => {
    const catalog = mobileNativeChatSlashCatalog({
      agent: 'claude',
      scannedSkills: [],
      sessionCommands: [{ name: 'claude-mem:mem-search', kind: 'skill' }]
    })
    expect(catalog.skills.map((entry) => entry.name)).toEqual(['claude-mem:mem-search'])
  })

  it('drops a scanned skill the session never loaded', () => {
    const catalog = mobileNativeChatSlashCatalog({
      agent: 'claude',
      scannedSkills: [skill({ name: 'unslop' }), skill({ name: 'deslop' })],
      sessionCommands: [{ name: 'unslop', kind: 'skill' }]
    })
    expect(catalog.skills.map((entry) => entry.name)).toEqual(['unslop'])
  })

  it('keeps the scanned description and scope for a name both know', () => {
    const scanned = skill({
      name: 'unslop',
      description: 'Cut AI tells from any writing.',
      sourceKind: 'repo'
    })
    const catalog = mobileNativeChatSlashCatalog({
      agent: 'claude',
      scannedSkills: [scanned],
      sessionCommands: [{ name: 'unslop', kind: 'skill' }]
    })
    expect(catalog.skills[0]).toBe(scanned)
  })

  it('matches a reported plugin skill against the scan by its dispatch token', () => {
    // The scan reports the bare name plus a plugin source label; the session
    // reports the namespaced token its own `/` menu shows.
    const scanned = skill({
      name: 'mem-search',
      description: 'Search claude-mem.',
      sourceKind: 'plugin',
      sourceLabel: 'Claude plugin claude-mem'
    })
    const catalog = mobileNativeChatSlashCatalog({
      agent: 'claude',
      scannedSkills: [scanned],
      sessionCommands: [{ name: 'claude-mem:mem-search', kind: 'skill' }]
    })
    expect(catalog.skills).toEqual([scanned])
  })

  it('sorts a skill the scan could not locate after the ones it could', () => {
    const scanned = skill({ name: 'unslop' })
    const catalog = mobileNativeChatSlashCatalog({
      agent: 'claude',
      scannedSkills: [scanned],
      sessionCommands: [
        { name: 'ref-oss', kind: 'skill' },
        { name: 'unslop', kind: 'skill' }
      ]
    })
    expect(catalog.skills.map((entry) => entry.name)).toEqual(['unslop', 'ref-oss'])
  })

  it('reads an unclassified name as a skill when the scan knows it as one', () => {
    const scanned = skill({ name: 'unslop' })
    const catalog = mobileNativeChatSlashCatalog({
      agent: 'claude',
      scannedSkills: [scanned],
      sessionCommands: [{ name: 'unslop', kind: 'command', kindUnspecified: true }]
    })
    expect(catalog.commands).toEqual([])
    expect(catalog.skills).toEqual([scanned])
  })

  it('keeps an unclassified name the scan does not know as a command', () => {
    const catalog = mobileNativeChatSlashCatalog({
      agent: 'claude',
      scannedSkills: [],
      sessionCommands: [{ name: 'rewind', kind: 'command', kindUnspecified: true }]
    })
    expect(catalog.commands.map((command) => command.name)).toEqual(['rewind'])
    expect(catalog.skills).toEqual([])
  })
})

describe('the `/` menu without a session report', () => {
  it('keeps the curated catalog and the whole disk scan', () => {
    const scanned = skill({ name: 'unslop' })
    const catalog = mobileNativeChatSlashCatalog({
      agent: 'claude',
      scannedSkills: [scanned]
    })
    expect(catalog.commands.map((command) => command.name)).toContain('compact')
    expect(catalog.skills).toEqual([scanned])
  })

  it('drops skills the active agent cannot invoke', () => {
    const catalog = mobileNativeChatSlashCatalog({
      agent: 'claude',
      scannedSkills: [skill({ name: 'codex-only', providers: ['codex'] })]
    })
    expect(catalog.skills).toEqual([])
  })

  it('offers no commands when no agent is known', () => {
    expect(mobileNativeChatSlashCatalog({ agent: null, scannedSkills: [] }).commands).toEqual([])
  })
})

describe('the `/` menu of a structured chat that has not reported its surface', () => {
  it('offers only what a chat session can carry out, not the whole TUI catalog', () => {
    const catalog = mobileNativeChatSlashCatalog({
      agent: 'claude',
      scannedSkills: [],
      conversationCommands: ['clear', 'compact']
    })
    expect(catalog.commands.map((command) => command.name)).toEqual([
      'model',
      'effort',
      'clear',
      'compact'
    ])
  })

  it('drops a conversation command this host cannot carry out', () => {
    const catalog = mobileNativeChatSlashCatalog({
      agent: 'claude',
      scannedSkills: [],
      conversationCommands: []
    })
    expect(catalog.commands.map((command) => command.name)).toEqual(['model', 'effort'])
  })

  it('still offers the scanned skills', () => {
    const scanned = skill({ name: 'unslop' })
    const catalog = mobileNativeChatSlashCatalog({
      agent: 'claude',
      scannedSkills: [scanned],
      conversationCommands: ['compact']
    })
    expect(catalog.skills).toEqual([scanned])
  })

  it('yields to the session report once one arrives', () => {
    const catalog = mobileNativeChatSlashCatalog({
      agent: 'claude',
      scannedSkills: [],
      conversationCommands: ['clear', 'compact'],
      sessionCommands: [{ name: 'clear', kind: 'command' }]
    })
    expect(catalog.commands.map((command) => command.name)).toEqual(['clear'])
  })
})
