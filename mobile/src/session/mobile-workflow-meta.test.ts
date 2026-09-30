import { describe, expect, it } from 'vitest'
import { parseWorkflowMeta } from './mobile-workflow-meta'
import { WORKFLOW_META_HEAD, WORKFLOW_SCRIPT } from './fixtures/claude-workflow-2.1.284'

// The meta literal is read off the script Claude Code was handed, so the
// phone can name the workflow and its phases. Verified against the script of a
// real Workflow call (Claude Code 2.1.284, fixtures/claude-workflow-2.1.284.ts).
describe('parseWorkflowMeta', () => {
  it('reads name, description and phase titles from the real script', () => {
    const meta = parseWorkflowMeta(WORKFLOW_SCRIPT)
    expect(meta?.name).toBe('pre-release-review-sweep')
    expect(meta?.description).toBe(
      'Parallel Sonnet reviewers find proven bugs across Code UI; Opus triages, fixes in worktrees, integrates; Sonnet re-reviews'
    )
    expect(meta?.phases?.map((phase) => phase.title)).toEqual(['Review', 'Triage', 'Fix', 'Integrate', 'Re-review'])
    expect(meta?.phases?.[2]?.detail).toBe('Opus fixers, one worktree per batch, failing-first tests')
  })

  it('still reads the literal when the script was cut right after it', () => {
    expect(parseWorkflowMeta(WORKFLOW_META_HEAD)?.name).toBe('pre-release-review-sweep')
  })

  it('never runs the script: code in the literal is refused, not evaluated', () => {
    const marker = { ran: false }
    Reflect.set(globalThis, '__workflowMetaProbe', marker)
    const script = "export const meta = { name: (globalThis.__workflowMetaProbe.ran = true, 'x'), phases: [] }"
    expect(parseWorkflowMeta(script)).toBeNull()
    expect(marker.ran).toBe(false)
    Reflect.deleteProperty(globalThis, '__workflowMetaProbe')
  })

  it('refuses a template literal with an interpolation and a computed name', () => {
    expect(parseWorkflowMeta('export const meta = { name: `a${b}` }')).toBeNull()
    expect(parseWorkflowMeta("export const meta = { name: 'a' + 'b' }")).toBeNull()
  })

  it('refuses a script with no meta, an empty script and a literal cut in half', () => {
    expect(parseWorkflowMeta("const x = 1\nawait agent('hi')")).toBeNull()
    expect(parseWorkflowMeta('')).toBeNull()
    expect(parseWorkflowMeta("export const meta = { name: 'half', phases: [ { title: 'Rev")).toBeNull()
  })

  it('reads a meta with no phases as a name and no phase list', () => {
    const meta = parseWorkflowMeta("export const meta = { name: 'solo', description: 'one agent' }")
    expect(meta).toEqual({ name: 'solo', description: 'one agent', phases: null })
  })

  it('keeps an empty phase list distinct from a missing one', () => {
    expect(parseWorkflowMeta("export const meta = { name: 'a', phases: [] }")?.phases).toEqual([])
  })

  it('drops a phase with no usable title instead of drawing a blank section', () => {
    const meta = parseWorkflowMeta("export const meta = { name: 'a', phases: [{ title: 'One' }, { detail: 'x' }, 'Three', { title: '  ' }] }")
    expect(meta?.phases?.map((phase) => phase.title)).toEqual(['One'])
  })

  it('handles comments, trailing commas, double quotes and escapes', () => {
    const script = `// leading\nexport const meta = {\n  /* the name */ name: "it\\'s \\"q\\"", // note\n  phases: [ { title: 'A\\nB', }, ],\n}\n`
    const meta = parseWorkflowMeta(script)
    expect(meta?.name).toBe('it\'s "q"')
    expect(meta?.phases?.[0]?.title).toBe('A\nB')
  })
})
