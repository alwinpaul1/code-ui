import { describe, expect, it } from 'vitest'
import { homeBodyKind } from './home-body-kind'

describe('home body before the paired-host list has arrived', () => {
  it('is not the pairing screen while the list is still loading, empty or not', () => {
    expect(homeBodyKind(false, 0, false)).toBe('loading')
    expect(homeBodyKind(false, 1, false)).toBe('loading')
    // A re-read after an earlier failure: still loading, not the old failure.
    expect(homeBodyKind(false, 0, true)).toBe('loading')
  })

  it('shows the pairing screen to a phone whose finished read found no desktop', () => {
    expect(homeBodyKind(true, 0, false)).toBe('pair')
  })

  it('skips the pairing screen for one paired desktop and for several', () => {
    expect(homeBodyKind(true, 1, false)).toBe('hosts')
    expect(homeBodyKind(true, 2, false)).toBe('hosts')
    expect(homeBodyKind(true, 5, false)).toBe('hosts')
  })
})

describe('home body when the paired-host list could not be read', () => {
  it('does not tell a paired phone to pair when the read failed with no list to keep', () => {
    expect(homeBodyKind(true, 0, true)).toBe('failed')
  })

  it('keeps drawing the list when a re-read fails with one desktop or several on screen', () => {
    expect(homeBodyKind(true, 1, true)).toBe('hosts')
    expect(homeBodyKind(true, 2, true)).toBe('hosts')
  })
})
