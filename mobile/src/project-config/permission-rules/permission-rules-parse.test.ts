import { describe, expect, it } from 'vitest'
import {
  parsePermissionSettings,
  serializePermissionSettings,
  withPermissionRuleAdded,
  withPermissionRuleRemoved
} from './permission-rules-parse'

describe('parsing .claude/settings*.json for its permission rules', () => {
  it('reads all three rule categories', () => {
    const result = parsePermissionSettings(
      JSON.stringify({
        permissions: { allow: ['Read', 'Bash(npm run *)'], deny: ['Bash(rm -rf *)'], ask: ['Edit'] }
      })
    )
    expect(result.ok).toBe(true)
    expect(result.ok && result.rules).toEqual({
      allow: ['Read', 'Bash(npm run *)'],
      deny: ['Bash(rm -rf *)'],
      ask: ['Edit']
    })
  })

  it('degenerate: a settings file with no permissions key reads as three empty arrays', () => {
    const result = parsePermissionSettings(JSON.stringify({ model: 'opus' }))
    expect(result.ok).toBe(true)
    expect(result.ok && result.rules).toEqual({ allow: [], deny: [], ask: [] })
    expect(result.ok && result.settings).toEqual({ model: 'opus' })
  })

  it('degenerate: an empty file reads as an empty settings object with no rules', () => {
    expect(parsePermissionSettings('')).toEqual({ ok: true, settings: {}, rules: { allow: [], deny: [], ask: [] } })
  })

  it('degenerate: a whitespace-only file reads the same as empty', () => {
    expect(parsePermissionSettings('  \n\t')).toEqual({
      ok: true,
      settings: {},
      rules: { allow: [], deny: [], ask: [] }
    })
  })

  it('refuses malformed JSON and reports a line, never overwriting a file it could not parse', () => {
    const source = '{\n  "permissions": {\n    "allow": ["Read"],\n  }\n}'
    const result = parsePermissionSettings(source)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.line).toBe(4)
  })

  it('ignores a non-string entry in a rule array rather than crashing', () => {
    const result = parsePermissionSettings(JSON.stringify({ permissions: { allow: ['Read', 42, null] } }))
    expect(result.ok).toBe(true)
    expect(result.ok && result.rules.allow).toEqual(['Read'])
  })
})

describe('mutating permission rules while preserving everything else', () => {
  it('adds a rule to the destination category only', () => {
    const settings = { model: 'opus', permissions: { allow: ['Read'], defaultMode: 'plan' } }
    const next = withPermissionRuleAdded(settings, 'deny', 'Bash(curl *)')
    expect(next).toEqual({
      model: 'opus',
      permissions: { allow: ['Read'], defaultMode: 'plan', deny: ['Bash(curl *)'] }
    })
    // Untouched keys are the same values, not just equal ones.
    expect(next.model).toBe(settings.model)
  })

  it('does not duplicate a rule that is already present', () => {
    const settings = { permissions: { allow: ['Read'] } }
    expect(withPermissionRuleAdded(settings, 'allow', 'Read')).toEqual(settings)
  })

  it('trims whitespace off an added rule', () => {
    const next = withPermissionRuleAdded({}, 'allow', '  Read  ')
    expect(next).toEqual({ permissions: { allow: ['Read'] } })
  })

  it('degenerate: adding an empty/whitespace-only rule is a no-op', () => {
    const settings = { permissions: { allow: [] } }
    expect(withPermissionRuleAdded(settings, 'allow', '   ')).toBe(settings)
  })

  it('creates the permissions block from nothing when the file had none', () => {
    expect(withPermissionRuleAdded({ model: 'opus' }, 'ask', 'Edit')).toEqual({
      model: 'opus',
      permissions: { ask: ['Edit'] }
    })
  })

  it('removes a rule from its category only, leaving unrelated permission keys alone', () => {
    const settings = { permissions: { allow: ['Read', 'Edit'], additionalDirectories: ['../shared'] } }
    expect(withPermissionRuleRemoved(settings, 'allow', 'Edit')).toEqual({
      permissions: { allow: ['Read'], additionalDirectories: ['../shared'] }
    })
  })

  it('removing a rule that was never there is a no-op (same reference back)', () => {
    const settings = { permissions: { allow: ['Read'] } }
    expect(withPermissionRuleRemoved(settings, 'allow', 'Bash(x)')).toBe(settings)
  })

  it('degenerate: removing the last rule in a category leaves an empty array, not the key deleted', () => {
    const settings = { permissions: { deny: ['Bash(rm -rf *)'] } }
    expect(withPermissionRuleRemoved(settings, 'deny', 'Bash(rm -rf *)')).toEqual({
      permissions: { deny: [] }
    })
  })
})

describe('serializing settings back to text', () => {
  it('round-trips through parse → add → serialize → parse', () => {
    const parsed = parsePermissionSettings(JSON.stringify({ model: 'opus', permissions: { allow: ['Read'] } }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    const mutated = withPermissionRuleAdded(parsed.settings, 'deny', 'Bash(rm -rf *)')
    const text = serializePermissionSettings(mutated)
    const reparsed = parsePermissionSettings(text)
    expect(reparsed.ok).toBe(true)
    expect(reparsed.ok && reparsed.rules).toEqual({ allow: ['Read'], deny: ['Bash(rm -rf *)'], ask: [] })
    expect(reparsed.ok && reparsed.settings.model).toBe('opus')
  })

  it('uses 2-space indent', () => {
    const text = serializePermissionSettings({ permissions: { allow: ['Read'] } })
    expect(text).toContain('\n  "permissions"')
  })
})
