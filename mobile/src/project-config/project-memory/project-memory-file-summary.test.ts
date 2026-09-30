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

  function ready(content: string): ProjectConfigFileState {
    return {
      status: 'ready',
      content,
      savedContent: content,
      isDirty: false,
      saving: false,
      saveError: null,
      creating: false,
      createError: null
    }
  }

  // Review 2026-09-30: `content.length` counts UTF-16 code units, so a CLAUDE.md with an em dash,
  // an umlaut or a check mark read smaller than it is, and in a different unit from the too-large
  // branch, which takes the host's own byte count.
  it('counts a ready file in UTF-8 bytes, the unit the host counts a too-large one in', () => {
    const summary = summarizeProjectMemoryFile('CLAUDE.md', ready('# Über — naïve ✓\n'))
    expect(summary).toEqual({ kind: 'present', byteLength: 23, empty: false })
    expect(describeProjectMemorySummary(summary)).toBe('23 bytes')
  })

  it('says "1 byte" for a one-byte file, not "1 bytes"', () => {
    expect(describeProjectMemorySummary(summarizeProjectMemoryFile('CLAUDE.md', ready('#')))).toBe(
      '1 byte'
    )
  })

  it('shows KB from 1024 bytes up and never "1024 KB" at the MB boundary', () => {
    const present = (byteLength: number) =>
      describeProjectMemorySummary({ kind: 'present', byteLength, empty: false })
    expect(present(1023)).toBe('1023 bytes')
    expect(present(1024)).toBe('1 KB')
    expect(present(1024 * 1024 - 1)).toBe('1.0 MB')
    expect(present(1024 * 1024)).toBe('1.0 MB')
    expect(present(1_048_000)).toBe('1023 KB')
  })

  it('a truncated file is still "present" (Create must not be offered for a file that exists)', () => {
    const summary = summarizeProjectMemoryFile('CLAUDE.md', { status: 'too-large', byteLength: 999_999 })
    expect(summary).toEqual({ kind: 'present', byteLength: 999_999, empty: false })
  })
})
