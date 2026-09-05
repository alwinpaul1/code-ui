import { describe, it, expect } from 'vitest'

import { parseSemver, compareVersions, isNewerVersion, maxSemver } from './version-compare'

describe('parseSemver', () => {
  it('parses a strict x.y.z version', () => {
    expect(parseSemver('0.0.20')).toEqual({ major: 0, minor: 0, patch: 20 })
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  it('rejects malformed input', () => {
    expect(parseSemver('0.0')).toBeNull()
    expect(parseSemver('0.0.0.0')).toBeNull()
    expect(parseSemver('v0.0.20')).toBeNull()
    expect(parseSemver('0.0.20-rc.1')).toBeNull()
    expect(parseSemver('')).toBeNull()
    expect(parseSemver(null)).toBeNull()
    expect(parseSemver(undefined)).toBeNull()
    expect(parseSemver('  1.2.3  ')).toEqual({ major: 1, minor: 2, patch: 3 })
  })
})

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('0.0.20', '0.0.21')).toBe(-1)
    expect(compareVersions('0.0.21', '0.0.20')).toBe(1)
    expect(compareVersions('0.1.0', '0.0.99')).toBe(1)
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareVersions('0.0.20', '0.0.20')).toBe(0)
  })

  it('sorts invalid versions before valid ones', () => {
    expect(compareVersions('nope', '0.0.1')).toBe(-1)
    expect(compareVersions('0.0.1', 'nope')).toBe(1)
    expect(compareVersions('nope', 'also-nope')).toBe(0)
    expect(compareVersions(null, undefined)).toBe(0)
  })
})

describe('isNewerVersion', () => {
  it('is true only when candidate is strictly greater', () => {
    expect(isNewerVersion('0.0.21', '0.0.20')).toBe(true)
    expect(isNewerVersion('0.0.20', '0.0.20')).toBe(false)
    expect(isNewerVersion('0.0.19', '0.0.20')).toBe(false)
    expect(isNewerVersion(null, '0.0.20')).toBe(false)
    expect(isNewerVersion('0.0.21', null)).toBe(true)
  })
})

describe('maxSemver', () => {
  it('returns the highest valid version', () => {
    expect(maxSemver('0.0.20', '0.0.21', '0.0.19')).toBe('0.0.21')
    expect(maxSemver('1.0.0', '0.99.99')).toBe('1.0.0')
  })

  it('ignores nullish and invalid inputs', () => {
    expect(maxSemver(null, undefined, '0.0.20', 'bad')).toBe('0.0.20')
    expect(maxSemver(null, undefined)).toBeNull()
    expect(maxSemver('bad', 'alsobad')).toBeNull()
  })

  it('returns null for no inputs', () => {
    expect(maxSemver()).toBeNull()
  })
})
