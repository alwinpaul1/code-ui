import { describe, expect, it, vi } from 'vitest'

const disk = vi.hoisted(() => ({ files: new Map<string, string>(), creates: [] as string[] }))
vi.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///data/user/0/app/cache/' } },
  File: class {
    uri: string
    constructor(parent: { uri: string } | string, name?: string) {
      if (typeof parent === 'string' && parent.startsWith('bad:')) {
        throw new Error('not a file URI')
      }
      this.uri = typeof parent === 'string' ? parent : `${parent.uri}${name}`
    }
    get exists(): boolean {
      return disk.files.has(this.uri)
    }
    create(options: { overwrite: boolean }): void {
      disk.creates.push(`${this.uri} overwrite=${options.overwrite}`)
      disk.files.set(this.uri, '')
    }
    write(content: string, options: { encoding: string }): void {
      disk.files.set(this.uri, `${options.encoding}:${content}`)
    }
  }
}))

import { hostImageFileStore } from './host-image-file-store.native'
import { hostImageFileStore as noFileSystem } from './host-image-file-store'

// What Metro bundles for Android and iOS, against expo-file-system's File API
// as mobile-pdf-cache.ts uses it (expo-file-system 57).
describe("the phone's store for host pictures", () => {
  it('writes the base64 into a file of that name in the cache directory, overwriting, and hands back its URI', () => {
    const uri = hostImageFileStore!.write('codeui-host-image-1a2b.jpeg', '/9j/4AAQ')
    expect(uri).toBe('file:///data/user/0/app/cache/codeui-host-image-1a2b.jpeg')
    expect(disk.creates).toEqual(['file:///data/user/0/app/cache/codeui-host-image-1a2b.jpeg overwrite=true'])
    expect(disk.files.get(uri)).toBe('base64:/9j/4AAQ')
    expect(hostImageFileStore!.exists(uri)).toBe(true)
  })

  it('says a file is gone once the system cleared it, and for a URI it cannot open', () => {
    expect(hostImageFileStore!.exists('file:///data/user/0/app/cache/codeui-host-image-gone.png')).toBe(false)
    expect(hostImageFileStore!.exists('bad:uri')).toBe(false)
  })

  it('is no store at all where there is no file system (web shell, test runner)', () => {
    expect(noFileSystem).toBeNull()
  })
})
