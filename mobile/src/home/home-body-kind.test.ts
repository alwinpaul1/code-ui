import { describe, expect, it } from 'vitest'
import { homeBodyKind } from './home-body-kind'

describe('home body before the paired-host list has arrived', () => {
  it('is not the pairing screen while the list is still loading, empty or not', () => {
    expect(homeBodyKind(false, 0)).toBe('loading')
    expect(homeBodyKind(false, 1)).toBe('loading')
  })

  it('shows the pairing screen to a phone whose finished read found no desktop', () => {
    expect(homeBodyKind(true, 0)).toBe('pair')
  })

  it('skips the pairing screen for one paired desktop and for several', () => {
    expect(homeBodyKind(true, 1)).toBe('hosts')
    expect(homeBodyKind(true, 5)).toBe('hosts')
  })
})
