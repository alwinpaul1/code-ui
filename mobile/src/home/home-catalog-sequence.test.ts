import { describe, expect, it } from 'vitest'
import { createHomeCatalogSequence } from './home-catalog-sequence'

describe('home catalog answer ordering', () => {
  it('accepts a lone read, and one read only once', () => {
    const seq = createHomeCatalogSequence()
    const n = seq.start()
    expect(seq.accept(n, 2)).toBe(true)
    expect(seq.accept(n, 2)).toBe(false)
  })

  it('drops an older read that lands after a newer one was applied', () => {
    const seq = createHomeCatalogSequence()
    const older = seq.start()
    const newer = seq.start()
    expect(seq.accept(newer, 1)).toBe(true)
    expect(seq.accept(older, 3)).toBe(false)
  })

  it('drops every read started before a local change, and takes ones started after', () => {
    const seq = createHomeCatalogSequence()
    const before = seq.start()
    seq.localChange(1)
    expect(seq.accept(before, 2)).toBe(false)
    expect(seq.accept(seq.start(), 1)).toBe(true)
  })

  it('reports whether a list with hosts is drawn, and whether any answer exists', () => {
    const seq = createHomeCatalogSequence()
    expect(seq.hasAnswer()).toBe(false)
    expect(seq.drawingHosts()).toBe(false)
    seq.accept(seq.start(), 0)
    expect(seq.hasAnswer()).toBe(true)
    expect(seq.drawingHosts()).toBe(false)
    seq.localChange(2)
    expect(seq.drawingHosts()).toBe(true)
  })

  it('lets a read fail as current only while nothing newer has drawn a list', () => {
    const seq = createHomeCatalogSequence()
    const lone = seq.start()
    expect(seq.superseded(lone)).toBe(false)
    const older = seq.start()
    const newer = seq.start()
    seq.accept(newer, 1)
    expect(seq.superseded(older)).toBe(true)
    const beforeRemoval = seq.start()
    seq.localChange(0)
    expect(seq.superseded(beforeRemoval)).toBe(true)
    expect(seq.superseded(seq.start())).toBe(false)
  })

  it('handles the degenerate sizes: one host and none', () => {
    const seq = createHomeCatalogSequence()
    seq.localChange(1)
    expect(seq.drawingHosts()).toBe(true)
    seq.localChange(0)
    expect(seq.drawingHosts()).toBe(false)
  })
})
