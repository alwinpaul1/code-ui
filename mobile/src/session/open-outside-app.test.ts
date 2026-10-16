/**
 * "Open in browser" for a claude.ai link must not land back in Code UI's own viewer once the user
 * has turned on "Open supported links" for it. These pin the JavaScript side: the native module
 * opens a browser by package name, and every way it can be missing or fail still opens the link.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openUrlOutsideApp } from './open-outside-app'
import { openExternalLink } from '../platform/external-link'

const LINK = 'https://claude.ai/artifact/8JHvPGXwg2SLbchagvbYU6'

const native = vi.hoisted(() => ({
  present: true,
  calls: [] as string[],
  answer: (): Promise<string> => Promise.resolve('opened')
}))

vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) =>
    native.present && name === 'OrcaArtifactShortcuts'
      ? {
          openUrlOutsideApp: (url: string) => {
            native.calls.push(url)
            return native.answer()
          }
        }
      : null
}))

vi.mock('../platform/external-link', () => ({ openExternalLink: vi.fn() }))

beforeEach(() => {
  native.present = true
  native.calls = []
  native.answer = () => Promise.resolve('opened')
  vi.mocked(openExternalLink).mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('opening a link outside the app', () => {
  it('hands an https link to a browser by package and does not also open it with Linking', async () => {
    await openUrlOutsideApp(LINK)
    expect(native.calls).toEqual([LINK])
    expect(openExternalLink).not.toHaveBeenCalled()
  })

  it('falls back to Linking when no browser is installed, and says so', async () => {
    native.answer = () => Promise.resolve('none')
    await openUrlOutsideApp(LINK)
    expect(openExternalLink).toHaveBeenCalledWith(LINK)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('answered none'))
  })

  it('falls back to Linking when the native side reports a failure', async () => {
    native.answer = () => Promise.resolve('failed')
    await openUrlOutsideApp(LINK)
    expect(openExternalLink).toHaveBeenCalledWith(LINK)
  })

  it('falls back to Linking when the native call rejects, and names why', async () => {
    native.answer = () => Promise.reject(new Error('ActivityNotFoundException'))
    await openUrlOutsideApp(LINK)
    expect(openExternalLink).toHaveBeenCalledWith(LINK)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('ActivityNotFoundException'))
  })

  it('opens with Linking where the native module is not in the build (web, iOS, tests)', async () => {
    native.present = false
    await openUrlOutsideApp(LINK)
    expect(openExternalLink).toHaveBeenCalledWith(LINK)
    expect(native.calls).toEqual([])
  })

  it('opens nothing for a link that is not https, and warns', async () => {
    for (const url of ['http://claude.ai/artifact/x', 'intent://x#Intent;end', 'codeui://artifact?url=x', 'file:///etc/hosts', '']) {
      await openUrlOutsideApp(url)
    }
    expect(native.calls).toEqual([])
    expect(openExternalLink).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledTimes(5)
  })
})
