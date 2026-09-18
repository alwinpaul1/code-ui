import { describe, expect, it } from 'vitest'
import { describeProjectMemorySummary, summarizeProjectMemoryFile } from './project-memory-file-summary'
import type { ProjectConfigFileState } from '../use-project-config-file'

describe('summarizing a CLAUDE.md candidate for the chooser row', () => {
  it('reads a present, non-empty file as its byte length', () => {
    const state: ProjectConfigFileState = {
      status: 'ready',
      content: 'Some memory',
      savedContent: 'Some memory',
      isDirty: false,
      saving: false,
      saveError: null,
      creating: false,
      createError: null
    }
    expect(summarizeProjectMemoryFile('CLAUDE.md', state)).toEqual({
      kind: 'present',
      byteLength: 11,
      empty: false
    })
    expect(describeProjectMemorySummary(summarizeProjectMemoryFile('CLAUDE.md', state))).toBe('11 bytes')
  })

  it('degenerate: a present but whitespace-only file reads as empty, not as "N bytes"', () => {
    const state: ProjectConfigFileState = {
      status: 'ready',
      content: '   \n',
      savedContent: '   \n',
      isDirty: false,
      saving: false,
      saveError: null,
      creating: false,
      createError: null
    }
    const summary = summarizeProjectMemoryFile('CLAUDE.md', state)
    expect(summary).toMatchObject({ kind: 'present', empty: true })
    expect(describeProjectMemorySummary(summary)).toBe('Empty file')
  })

  it('offers Create for a file that does not exist yet', () => {
    const summary = summarizeProjectMemoryFile('.claude/CLAUDE.md', { status: 'missing' })
    expect(summary).toEqual({ kind: 'missing' })
    expect(describeProjectMemorySummary(summary)).toBe('Not created yet')
  })

  it('shows the loading state while the read is in flight', () => {
    expect(describeProjectMemorySummary(summarizeProjectMemoryFile('CLAUDE.md', { status: 'loading' }))).toBe(
      'Checking…'
    )
  })

  it('surfaces a read error’s own message rather than a generic one', () => {
    const summary = summarizeProjectMemoryFile('CLAUDE.md', {
      status: 'error',
      message: 'This path is outside the project, so the host refused it.'
    })
    expect(describeProjectMemorySummary(summary)).toBe(
      'This path is outside the project, so the host refused it.'
    )
  })

  it('a truncated file is still "present" (Create must not be offered for a file that exists)', () => {
    const summary = summarizeProjectMemoryFile('CLAUDE.md', { status: 'too-large', byteLength: 999_999 })
    expect(summary).toEqual({ kind: 'present', byteLength: 999_999, empty: false })
  })
})
