import { describe, expect, it } from 'vitest'
import {
  FILE_LINK_MENU_LABELS,
  fileLinkMenuEntries,
  fileLinkNames
} from './mobile-native-chat-file-link'

// The Claude app's long-press menu on an inline file link (1.261009.20,
// xt20.java:87-91, dqh.java:25-50): the path as written over "Open", "Copy file
// name" (the last segment, `cwy.f`) and, only when the file has a path relative
// to the project (`crh.c.b`), "Copy relative path".

describe('what a file link copies', () => {
  it('copies the last segment as the file name and a relative path as it is', () => {
    expect(fileLinkNames('src/session/MobileNativeChatMessage.tsx')).toEqual({
      fileName: 'MobileNativeChatMessage.tsx',
      relativePath: 'src/session/MobileNativeChatMessage.tsx'
    })
  })

  it('leaves out a ./ marker and a :line:column tail, neither of which is part of the file', () => {
    expect(fileLinkNames('./src/a.ts:42:7')).toEqual({ fileName: 'a.ts', relativePath: 'src/a.ts' })
    expect(fileLinkNames('src/a.ts:42')).toEqual({ fileName: 'a.ts', relativePath: 'src/a.ts' })
  })

  it('keeps a ../ that points out of the project: it is meaningful', () => {
    expect(fileLinkNames('../shared/x.ts')).toEqual({
      fileName: 'x.ts',
      relativePath: '../shared/x.ts'
    })
  })

  it.each([
    ['/Users/dev/proj/src/a.ts', 'a.ts'],
    ['~/proj/src/a.ts', 'a.ts'],
    ['C:\\Users\\dev\\proj\\a.ts', 'a.ts'],
    ['c:/Users/dev/proj/a.ts:3', 'a.ts']
  ])('gives the file name but no relative path for the absolute path %s', (path, fileName) => {
    expect(fileLinkNames(path)).toEqual({ fileName, relativePath: null })
  })

  it('reads a Windows relative path by its backslashes', () => {
    expect(fileLinkNames('src\\a.ts')).toEqual({ fileName: 'a.ts', relativePath: 'src\\a.ts' })
  })

  it('names a bare file as both its file name and its relative path', () => {
    expect(fileLinkNames('README.md')).toEqual({ fileName: 'README.md', relativePath: 'README.md' })
  })

  it('has nothing to copy for empty words', () => {
    expect(fileLinkNames('')).toEqual({ fileName: null, relativePath: null })
    expect(fileLinkNames('   ')).toEqual({ fileName: null, relativePath: null })
  })

  it('names a folder link by its last segment, trailing separator and all', () => {
    expect(fileLinkNames('src/')).toEqual({ fileName: 'src', relativePath: 'src/' })
  })
})

describe('the entries of the menu', () => {
  it('offers Open and Copy file name always, and Copy relative path only with a relative path', () => {
    expect(fileLinkMenuEntries({ fileName: 'a.ts', relativePath: 'src/a.ts' })).toEqual([
      'open',
      'copy-file-name',
      'copy-relative-path'
    ])
    expect(fileLinkMenuEntries({ fileName: 'a.ts', relativePath: null })).toEqual([
      'open',
      'copy-file-name'
    ])
  })

  it('offers only Open for a link that has no file name', () => {
    expect(fileLinkMenuEntries({ fileName: null, relativePath: null })).toEqual(['open'])
  })

  it('says them in the Claude app’s words', () => {
    expect(FILE_LINK_MENU_LABELS).toEqual({
      open: 'Open',
      'copy-file-name': 'Copy file name',
      'copy-relative-path': 'Copy relative path'
    })
  })
})
