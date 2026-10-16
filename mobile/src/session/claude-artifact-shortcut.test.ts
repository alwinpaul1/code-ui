/**
 * "Add to home screen" for an artifact, from the JavaScript side: what the launcher shortcut is
 * named, labelled and opens (the Claude Android app 1.261013.20's m2d.java:1466-1505 is the
 * model), and that every way the native pin can be missing or fail answers instead of throwing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pinClaudeArtifactShortcut } from './claude-artifact-shortcut'
import { redirectArtifactSystemPath } from './claude-artifact-native-intent'
import { PUBLISHED_LINK, PUBLISHED_UUID } from './fixtures/claude-artifact-tool-2.1.301'

type Call = { id: string; shortLabel: string; longLabel: string; uri: string }

const native = vi.hoisted(() => ({
  present: true,
  calls: [] as { id: string; shortLabel: string; longLabel: string; uri: string }[],
  answer: (): Promise<string> => Promise.resolve('pinned')
}))

const key = vi.hoisted(() => ({ value: 'key-1' as string | null }))
vi.mock('./claude-artifact-shortcut-key', () => ({ artifactShortcutKey: async () => key.value }))

vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) =>
    native.present && name === 'OrcaArtifactShortcuts'
      ? {
          requestPinShortcut: (id: string, shortLabel: string, longLabel: string, uri: string) => {
            native.calls.push({ id, shortLabel, longLabel, uri })
            return native.answer()
          }
        }
      : null
}))

function onlyCall(): Call {
  expect(native.calls).toHaveLength(1)
  return native.calls[0]!
}

/** The route and params Expo Router opens for a URL, after +native-intent, read as it reads them. */
function routeOpenedBy(uri: string): { pathname: string; params: Record<string, string> } {
  const path = redirectArtifactSystemPath(uri)
  const url = new URL(path, 'file:')
  return { pathname: url.pathname, params: Object.fromEntries(url.searchParams.entries()) }
}

beforeEach(() => {
  native.present = true
  native.calls = []
  native.answer = () => Promise.resolve('pinned')
  key.value = 'key-1'
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pinning an artifact to the home screen', () => {
  it('names the shortcut by the artifact uuid, so pinning it twice finds the first one', async () => {
    await expect(pinClaudeArtifactShortcut({ url: PUBLISHED_LINK, title: 'Release dashboard' })).resolves.toBe(
      'pinned'
    )
    expect(onlyCall().id).toBe(`artifact_page_${PUBLISHED_UUID}`)
  })

  it('gives the same id to the /code/artifact/<slug-uuid> form of the same artifact', async () => {
    await pinClaudeArtifactShortcut({
      url: `https://claude.ai/code/artifact/release-dashboard-${PUBLISHED_UUID}`,
      title: 'Release dashboard'
    })
    expect(onlyCall().id).toBe(`artifact_page_${PUBLISHED_UUID}`)
  })

  it('labels a short title in full on both labels', async () => {
    await pinClaudeArtifactShortcut({ url: PUBLISHED_LINK, title: '  Release dashboard ' })
    const call = onlyCall()
    expect(call.shortLabel).toBe('Release dashboard')
    expect(call.longLabel).toBe('Release dashboard')
  })

  it('cuts a long title to 25 characters on the short label and keeps all of it on the long one', async () => {
    const title = 'Quarterly revenue by region and product line'
    await pinClaudeArtifactShortcut({ url: PUBLISHED_LINK, title })
    const call = onlyCall()
    expect(call.longLabel).toBe(title)
    expect(Array.from(call.shortLabel)).toHaveLength(25)
    expect(call.shortLabel).toBe('Quarterly revenue by reg…')
  })

  it('keeps a title of exactly 25 characters whole', async () => {
    const title = 'A'.repeat(25)
    await pinClaudeArtifactShortcut({ url: PUBLISHED_LINK, title })
    expect(onlyCall().shortLabel).toBe(title)
  })

  it('never splits an emoji when it cuts the short label', async () => {
    const title = `${'x'.repeat(23)}🚀🚀🚀`
    await pinClaudeArtifactShortcut({ url: PUBLISHED_LINK, title })
    expect(onlyCall().shortLabel).toBe(`${'x'.repeat(23)}🚀…`)
  })

  it('labels an untitled artifact rather than sending Android an empty label', async () => {
    await pinClaudeArtifactShortcut({ url: PUBLISHED_LINK, title: ' \n ' })
    const call = onlyCall()
    expect(call.shortLabel).toBe('Artifact')
    expect(call.longLabel).toBe('Artifact')
  })

  it('opens a codeui://artifact link that carries the link and title encoded', async () => {
    await pinClaudeArtifactShortcut({ url: `${PUBLISHED_LINK}?sk=a+b&x=1`, title: 'Q&A board #2' })
    expect(onlyCall().uri).toBe(
      `codeui://artifact?url=${encodeURIComponent(`${PUBLISHED_LINK}?sk=a+b&x=1`)}&title=${encodeURIComponent('Q&A board #2')}&k=key-1`
    )
  })

  it('carries no key when none could be kept, so opening it asks first', async () => {
    key.value = null
    await pinClaudeArtifactShortcut({ url: PUBLISHED_LINK, title: 'T' })
    expect(onlyCall().uri).toBe(`codeui://artifact?url=${encodeURIComponent(PUBLISHED_LINK)}&title=T`)
  })

  it("reaches the viewer route with the share key and an & in the title intact", async () => {
    const url = `${PUBLISHED_LINK}?sk=a+b&x=1`
    await pinClaudeArtifactShortcut({ url, title: 'Q&A board #2' })
    expect(routeOpenedBy(onlyCall().uri)).toEqual({
      pathname: '/artifact',
      params: { url, title: 'Q&A board #2', k: 'key-1', external: '1' }
    })
  })

  it('drops a #fragment from the link the shortcut opens', async () => {
    await pinClaudeArtifactShortcut({ url: `${PUBLISHED_LINK}#section`, title: 'T' })
    expect(routeOpenedBy(onlyCall().uri).params.url).toBe(PUBLISHED_LINK)
  })

  it('passes the native answers through', async () => {
    for (const answer of ['pinned', 'already', 'unsupported', 'failed'] as const) {
      native.answer = () => Promise.resolve(answer)
      await expect(pinClaudeArtifactShortcut({ url: PUBLISHED_LINK, title: 'T' })).resolves.toBe(answer)
    }
  })
})

describe('when the pin cannot happen', () => {
  it('answers unsupported where the native module is not in the build (web, iOS, tests)', async () => {
    native.present = false
    await expect(pinClaudeArtifactShortcut({ url: PUBLISHED_LINK, title: 'T' })).resolves.toBe('unsupported')
    expect(native.calls).toEqual([])
  })

  it('answers failed when the native call rejects, and says why', async () => {
    native.answer = () => Promise.reject(new Error('SecurityException: not the default launcher'))
    await expect(pinClaudeArtifactShortcut({ url: PUBLISHED_LINK, title: 'T' })).resolves.toBe('failed')
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('SecurityException'))
  })

  it('answers failed when the native side answers something it does not know', async () => {
    native.answer = () => Promise.resolve('maybe')
    await expect(pinClaudeArtifactShortcut({ url: PUBLISHED_LINK, title: 'T' })).resolves.toBe('failed')
  })

  it('answers failed for a link that is not a claude.ai artifact, without asking the launcher', async () => {
    for (const url of ['https://example.com/artifact/8JHvPGXwg2SLbchagvbYU6', 'not a url', '']) {
      await expect(pinClaudeArtifactShortcut({ url, title: 'T' })).resolves.toBe('failed')
    }
    expect(native.calls).toEqual([])
  })
})
