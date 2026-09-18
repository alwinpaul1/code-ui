import { describe, expect, it } from 'vitest'
import {
  classifyProjectConfigFileError,
  describeProjectConfigFileError
} from './project-config-file-error'

// The three literal strings below are the host's real wire text, not
// paraphrases — see project-config-file-error.ts's header for where each
// one was read from in the Orca 1.4.205 bundle.
describe('classifying a project-config file RPC refusal', () => {
  it('reads the mobile-scope allowlist rejection as write-blocked', () => {
    expect(
      classifyProjectConfigFileError("Method 'files.write' is not available to mobile clients")
    ).toBe('write-blocked')
  })

  it('reads the jail check’s literal throw as jailed', () => {
    expect(classifyProjectConfigFileError('invalid_relative_path')).toBe('jailed')
  })

  it('reads the binary-file throw as binary', () => {
    expect(classifyProjectConfigFileError('binary_file')).toBe('binary')
  })

  it('reads a Node ENOENT message as missing', () => {
    expect(
      classifyProjectConfigFileError(
        "ENOENT: no such file or directory, open '/work/CLAUDE.md'"
      )
    ).toBe('missing')
  })

  it('falls back to unknown for anything else, rather than guessing', () => {
    expect(classifyProjectConfigFileError('socket hang up')).toBe('unknown')
  })
})

describe('describing a project-config file error for the screen', () => {
  it('never suggests retrying a write the host will always refuse', () => {
    const message = describeProjectConfigFileError(
      "Method 'files.write' is not available to mobile clients",
      'write'
    )
    expect(message).not.toMatch(/try again/i)
    expect(message).toMatch(/can't save/i)
  })

  it('words a blocked create differently from a blocked save', () => {
    const message = describeProjectConfigFileError(
      "Method 'files.write' is not available to mobile clients",
      'create'
    )
    expect(message).toMatch(/can't create/i)
  })

  it('says a missing file plainly on read, so the create flow can offer to make it', () => {
    expect(
      describeProjectConfigFileError(
        "ENOENT: no such file or directory, open '/work/.mcp.json'",
        'read'
      )
    ).toBe('Not found on the host yet.')
  })

  it('passes an unrecognised message straight through rather than swallowing it', () => {
    expect(describeProjectConfigFileError('socket hang up', 'read')).toBe('socket hang up')
  })

  it('never returns an empty string, even for an empty message', () => {
    expect(describeProjectConfigFileError('', 'read')).toBe('Something went wrong.')
  })
})
