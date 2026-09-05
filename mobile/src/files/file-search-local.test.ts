import { describe, expect, it } from 'vitest'
import {
  collectCachedFilePaths,
  filterFilePathsLocally,
  mergeFileSearchResults
} from './file-search-local'

describe('collectCachedFilePaths', () => {
  it('lists files from every loaded folder with their full relative path', () => {
    const paths = collectCachedFilePaths({
      '': { entries: [{ name: 'README.md', isDirectory: false }, { name: 'src', isDirectory: true }] },
      src: { entries: [{ name: 'main.ts', isDirectory: false }] },
      'src/deep': undefined
    })
    expect(paths).toEqual(['README.md', 'src/main.ts'])
  })
})

describe('filterFilePathsLocally', () => {
  const paths = ['BLADE_VLSI-SoC2026.pdf', 'overleaf_blade/main.tex', 'notes/blade-ideas.md', 'other.md']

  it('is case-insensitive and ranks name prefix, then name substring, then path matches', () => {
    expect(filterFilePathsLocally(paths, 'blade')).toEqual([
      'BLADE_VLSI-SoC2026.pdf',
      'notes/blade-ideas.md',
      'overleaf_blade/main.tex'
    ])
  })

  it('requires every term', () => {
    expect(filterFilePathsLocally(paths, 'blade tex')).toEqual(['overleaf_blade/main.tex'])
    expect(filterFilePathsLocally(paths, '   ')).toEqual([])
  })
})

describe('mergeFileSearchResults', () => {
  it('keeps local order and appends only new host hits', () => {
    expect(mergeFileSearchResults(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
  })
})
