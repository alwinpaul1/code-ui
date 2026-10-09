import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import {
  agentTextNamesPath,
  collectHostImagePaths,
  mergeImagePreviews,
  loadHostImage,
  resetHostImagePreviewCacheForTests
} from './use-host-image-previews'

function user(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }] } as NativeChatMessage
}

describe('collectHostImagePaths', () => {
  // 2026-09-13: the Read call lives in its own transcript record. Keyed by
  // that record, not a fold of this hook's own: the view folds with mid-turn
  // send boundaries this hook cannot see, and keying by the wrong fold left
  // the thumbnail off the row the view actually drew.
  it('keys an agent read image by its own record, for the view to remap', () => {
    const raw: NativeChatMessage[] = [
      { id: 'a1', role: 'assistant', blocks: [{ type: 'text', text: 'Looking.' }] } as NativeChatMessage,
      {
        id: 'a2',
        role: 'assistant',
        blocks: [{ type: 'tool-call', id: 'c1', name: 'Read', input: { file_path: '/repo/shot.png' } }]
      } as NativeChatMessage
    ]
    expect(collectHostImagePaths(raw, undefined)).toEqual({ a2: ['/repo/shot.png'] })
  })

  // Claude app, 2026-09-12: the screenshots an agent Read show as thumbnails
  // under its fold row. The transcript has no image block for a Read, so the
  // path from the tool call is what the phone can fetch a thumbnail of.
  it('lists the image files an agent message read, and only those', () => {
    const agent: NativeChatMessage = {
      id: 'a1',
      role: 'assistant',
      blocks: [
        { type: 'tool-call', id: 'c1', name: 'Read', input: { file_path: '/tmp/shot.png' } },
        { type: 'tool-call', id: 'c2', name: 'Read', input: { file_path: '/tmp/notes.md' } },
        { type: 'tool-call', id: 'c3', name: 'Bash', input: { command: 'cat /tmp/other.png' } },
        { type: 'tool-call', id: 'c4', name: 'Read', input: { file_path: '/tmp/second.JPG' } }
      ]
    } as NativeChatMessage
    expect(collectHostImagePaths([agent], undefined)).toEqual({ a1: ['/tmp/shot.png', '/tmp/second.JPG'] })
  })

  it('lists desktop-pasted image paths per user message, skipping phone sends', () => {
    const messages = [
      user('m1', 'look at this'),
      user('m2', '[Image: source: /var/folders/x/orca-paste-1.png]'),
      user('m3', '[Image: source: /var/folders/x/orca-paste-2.png]'),
      user('m4', '[Image: source: /tmp/phone.png]')
    ]
    const paths = collectHostImagePaths(messages, { m4: ['file:///local/phone.png'] })
    expect(paths.m1).toBeUndefined()
    expect(Object.values(paths).flat()).toEqual([
      '/var/folders/x/orca-paste-1.png',
      '/var/folders/x/orca-paste-2.png'
    ])
    expect(paths.m4).toBeUndefined()
  })
})

// Review, 2026-09-26: the chat draws each photo on the row its own companion
// trails, and the host is asked for each path on that same row. The two used
// to fold differently at a window that starts on the previous message's
// companion, so a desk message's thumbnail was the message before's.
describe('collectHostImagePaths, folded as the chat draws', () => {
  const row = (id: string, text: string): NativeChatMessage => ({
    id,
    role: 'user',
    blocks: [{ type: 'text', text }],
    timestamp: null,
    source: 'transcript'
  })
  const source = (id: string, file: string) => row(id, `[Image: source: /var/folders/0y/x/T/${file}.png]`)

  it('asks for each loaded message’s own photo when the window starts on the previous message’s companion', () => {
    const paths = collectHostImagePaths(
      [source('c0', 'zero'), row('p1', '[Image #1] second of two'), source('c1', 'one')],
      undefined
    )
    expect(paths).toEqual({
      c0: ['/var/folders/0y/x/T/zero.png'],
      p1: ['/var/folders/0y/x/T/one.png']
    })
  })
})

describe('mergeImagePreviews', () => {
  it('keeps local previews over host thumbnails for the same message', () => {
    expect(
      mergeImagePreviews(
        { a: ['file:///a.png'] },
        { a: ['data:image/png;base64,x'], b: ['data:b'] }
      )
    ).toEqual({ a: ['file:///a.png'], b: ['data:b'] })
  })
  it('returns the local map untouched when there is nothing from the host', () => {
    const local = { a: ['file:///a.png'] }
    expect(mergeImagePreviews(local, {})).toBe(local)
  })
})

describe('host image preview reads', () => {
  afterEach(() => {
    resetHostImagePreviewCacheForTests()
    vi.useRealTimers()
  })
  const args = {
    hostId: 'host',
    worktreeId: 'worktree',
    nativeChatContext: null,
    terminalHandle: 'term',
    path: '/tmp/a.png'
  }
  const preview = {
    ok: true,
    result: { isBinary: true, isImage: true, mimeType: 'image/png', content: 'AAAA' }
  }
  it('retries a failed resolution after the bounded cooldown', async () => {
    vi.useFakeTimers()
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          openTarget: { kind: 'absolute-file', absolutePath: '/tmp/a.png', grantId: 'grant' }
        }
      })
      .mockResolvedValueOnce(preview)
    const client = { sendRequest } as unknown as import('../transport/rpc-client').RpcClient
    expect(await loadHostImage({ ...args, client })).toBeNull()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await loadHostImage({ ...args, client })).toBe('data:image/png;base64,AAAA')
    expect(sendRequest).toHaveBeenCalledTimes(3)
  })
  it('reads a resolved workspace image through its workspace preview endpoint', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        result: {
          worktree: 'sibling',
          openTarget: { kind: 'worktree-file', relativePath: 'a.png' }
        }
      })
      .mockResolvedValueOnce(preview)
    const client = { sendRequest } as unknown as import('../transport/rpc-client').RpcClient
    expect(await loadHostImage({ ...args, client })).toBe('data:image/png;base64,AAAA')
    expect(sendRequest).toHaveBeenLastCalledWith(
      'files.readPreview',
      { worktree: 'id:sibling', relativePath: 'a.png' },
      expect.any(Object)
    )
  })
})

// The pictures an agent reads (Claude Code 2.1.283 reads screenshots with its
// Read tool) arrive from the host as base64. Held as `data:` strings, every
// picture of a long session stayed in the phone's memory for the whole run
// (the module cache never lets go). Each is written to the app's cache
// directory once and held as its file URI; Android's image pipeline decodes a
// local file down to the size it is drawn at.
describe('an image the agent read, once the host sends it', () => {
  afterEach(() => {
    resetHostImagePreviewCacheForTests()
    vi.restoreAllMocks()
  })
  const args = {
    hostId: 'host',
    worktreeId: 'worktree',
    nativeChatContext: { tabId: 'tab', sessionId: 'session' },
    terminalHandle: 'term',
    path: '/private/tmp/claude-501/scratchpad/imgs/img39_1.jpeg'
  }
  const granted = {
    ok: true,
    result: { openTarget: { kind: 'absolute-file', absolutePath: args.path, grantId: 'grant' } }
  }
  const jpeg = { ok: true, result: { isBinary: true, isImage: true, mimeType: 'image/jpeg', content: '/9j/4AAQ' } }
  function fakeFiles() {
    const files = new Map<string, string>()
    return {
      files,
      write: vi.fn((name: string, base64: string) => {
        files.set(`file:///cache/${name}`, base64)
        return `file:///cache/${name}`
      }),
      exists: (uri: string) => files.has(uri)
    }
  }
  const client = (...answers: unknown[]) => {
    const sendRequest = vi.fn()
    for (const answer of answers) {
      sendRequest.mockResolvedValueOnce(answer)
    }
    return { sendRequest } as unknown as import('../transport/rpc-client').RpcClient
  }

  it('is kept as a file in the cache, not as its base64 in memory, and read once', async () => {
    const store = fakeFiles()
    const rpc = client(granted, jpeg)
    const uri = await loadHostImage({ ...args, client: rpc, files: store })
    // SHA-256 of host and path, then the key's length.
    expect(uri).toMatch(/^file:\/\/\/cache\/codeui-host-image-[0-9a-f]{64}-\d+\.jpeg$/)
    expect([...store.files.values()]).toEqual(['/9j/4AAQ'])
    expect(await loadHostImage({ ...args, client: rpc, files: store })).toBe(uri)
    expect(rpc.sendRequest).toHaveBeenCalledTimes(2)
  })

  it('is read from the host again when the cache file was cleared', async () => {
    const store = fakeFiles()
    const rpc = client(granted, jpeg, granted, jpeg)
    const uri = await loadHostImage({ ...args, client: rpc, files: store })
    store.files.clear()
    expect(await loadHostImage({ ...args, client: rpc, files: store })).toBe(uri)
    expect(rpc.sendRequest).toHaveBeenCalledTimes(4)
  })

  it('still shows when the file cannot be written: it stays the data it came as, and says why once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const store = { write: vi.fn(() => { throw new Error('ENOSPC: no space left on device') }), exists: () => false }
    expect(await loadHostImage({ ...args, client: client(granted, jpeg), files: store })).toBe('data:image/jpeg;base64,/9j/4AAQ')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('ENOSPC')
  })

  // Review of 2026-09-26: the file name was a 32-bit djb2 hash of host and
  // path, written with overwrite, so two paths that hash alike shared one
  // file and the first picture showed the second's bytes.
  it('keeps two pictures apart even when their paths hash alike', async () => {
    // djb2("host\0…/page1Q.png") === djb2("host\0…/page20.png") === 0x30a300ae
    const first = '/private/tmp/shots/page1Q.png'
    const second = '/private/tmp/shots/page20.png'
    const store = fakeFiles()
    const grant = (path: string) => ({ ok: true, result: { openTarget: { kind: 'absolute-file', absolutePath: path, grantId: 'grant' } } })
    const png = (content: string) => ({ ok: true, result: { isBinary: true, isImage: true, mimeType: 'image/png', content } })
    const rpc = client(grant(first), png('FIRST'), grant(second), png('SECOND'))
    const firstUri = await loadHostImage({ ...args, path: first, client: rpc, files: store })
    const secondUri = await loadHostImage({ ...args, path: second, client: rpc, files: store })
    expect(firstUri).not.toBe(secondUri)
    expect(store.files.get(firstUri!)).toBe('FIRST')
    expect(store.files.get(secondUri!)).toBe('SECOND')
  })

  it('is read again when its cache file now holds another picture', async () => {
    // A store that puts every picture in one file: what a clash of names does.
    const files = new Map<string, string>()
    const store = {
      write: (_name: string, base64: string) => {
        files.set('file:///cache/one', base64)
        return 'file:///cache/one'
      },
      exists: (uri: string) => files.has(uri)
    }
    const other = '/private/tmp/shots/other.jpeg'
    const rpc = client(granted, jpeg, { ok: true, result: { openTarget: { kind: 'absolute-file', absolutePath: other, grantId: 'grant' } } }, { ...jpeg, result: { ...jpeg.result, content: 'OTHER' } }, granted, jpeg)
    await loadHostImage({ ...args, client: rpc, files: store })
    await loadHostImage({ ...args, path: other, client: rpc, files: store })
    expect(files.get('file:///cache/one')).toBe('OTHER')
    // The first picture's file holds the other's bytes now: it is read again.
    await loadHostImage({ ...args, client: rpc, files: store })
    expect(rpc.sendRequest).toHaveBeenCalledTimes(6)
    expect(files.get('file:///cache/one')).toBe('/9j/4AAQ')
  })

  it('stays the data it came as where there is no file system (the web shell)', async () => {
    expect(await loadHostImage({ ...args, client: client(granted, jpeg), files: null })).toBe('data:image/jpeg;base64,/9j/4AAQ')
  })

  // The host shares a file outside every workspace only when the agent's own
  // words or its terminal output named it (Orca 1.4.212). A Read's path is
  // rarely either (Claude Code paints it once, on a row its renderer can
  // split), so the step drew nothing, and nothing anywhere said why.
  it('leaves one line naming the path and why, when the host will not share it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const refused = { ok: true, result: { worktree: 'worktree', relativePath: null, absolutePath: args.path, exists: false } }
    expect(await loadHostImage({ ...args, client: client(refused), files: fakeFiles() })).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toBe(
      `[host-image] no picture for ${args.path}: the desktop did not share it (outside every workspace). ` +
        "Rule 1, named in the agent's text: it is not. " +
        'Rule 2, printed in terminal term: not found there as one unbroken path ' +
        "(Claude Code shows a Read's path once, while it runs, on a row its renderer can split or wrap)"
    )
  })
})

// 2026-10-09, Claude Code 2.1.295 in a Thesis session on Orca 1.4.223: three
// pictures the agent read from its scratchpad never showed, and the one line
// left behind said "not named in the agent's text or terminal output", which
// named neither rule nor whether either had even been tried. Outside every
// workspace the desktop shares a file on one of two rules: (1) the agent's
// text in the session's transcript names it, or (2) the tab's terminal
// printed it, unbroken, under a temp folder. Both refuse with the same empty
// resolution, so the line says what the phone knows of each.
describe('the line a refused agent-read picture leaves behind', () => {
  // The real tool_use path and the real terminal handle of that session.
  const path =
    '/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Thesis/36279b15-23eb-49ee-aa03-67b6555076bd/scratchpad/tp12-12.png'
  const handle = 'term_87d9e73b-ab0f-4ce3-887d-90f2f9fa2270'
  const worktree = '10e21f69-ad82-4743-8c4b-b938873247d6::/Users/alwinpaul/Desktop/Project/Thesis'
  // What Orca 1.4.223 answers for every refusal: no openTarget, exists false.
  const refused = {
    ok: true,
    result: { worktree, relativePath: null, absolutePath: path, exists: false, isDirectory: false }
  }
  const base = {
    hostId: 'host',
    worktreeId: worktree,
    nativeChatContext: { tabId: '1559e482-09d6-4325-96ea-ae90ff4cd634', sessionId: '36279b15-23eb-49ee-aa03-67b6555076bd' },
    terminalHandle: handle,
    path,
    files: null
  }
  const refusingClient = (): RpcClient => ({ sendRequest: vi.fn().mockResolvedValue(refused) }) as unknown as RpcClient
  const lineFor = async (args: Partial<Parameters<typeof loadHostImage>[0]>): Promise<string> => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await loadHostImage({ ...base, client: refusingClient(), ...args })).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    return String(warn.mock.calls[0]?.[0])
  }
  afterEach(() => {
    resetHostImagePreviewCacheForTests()
    vi.restoreAllMocks()
  })

  it('names both rules, and says the terminal never showed the path unbroken, for a scratchpad read', async () => {
    expect(await lineFor({})).toBe(
      `[host-image] no picture for ${path}: the desktop did not share it (outside every workspace). ` +
        "Rule 1, named in the agent's text: it is not. " +
        `Rule 2, printed in terminal ${handle}: not found there as one unbroken path ` +
        "(Claude Code shows a Read's path once, while it runs, on a row its renderer can split or wrap)"
    )
  })

  it('says rule 1 failed on the desktop when the agent text the phone holds does name the path', async () => {
    expect(await lineFor({ agentTextNamesPath: true })).toContain(
      "Rule 1, named in the agent's text: this chat's text names it, but the desktop's transcript tail did not."
    )
  })

  it('says which rule was never tried when no chat session and no terminal went with the ask', async () => {
    expect(await lineFor({ nativeChatContext: null, terminalHandle: null })).toBe(
      `[host-image] no picture for ${path}: the desktop did not share it (outside every workspace). ` +
        "Rule 1, named in the agent's text: not checked, no chat session was sent. " +
        'Rule 2, printed in the terminal: not checked, no terminal handle was sent'
    )
  })

  it('says rule 2 cannot apply to a file outside the temp folders', async () => {
    expect(await lineFor({ path: '/Users/alwinpaul/Pictures/shot.png' })).toContain(
      'Rule 2, printed in the terminal: cannot apply, it is outside the temp folders (/tmp, $TMPDIR)'
    )
  })

  // The failure path is untouched: a resolve the desktop rejects still says
  // the desktop's own reason, not a rule it never reached.
  it('still names the desktop’s own reason when it rejects the resolve outright', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const client = {
      sendRequest: vi.fn().mockResolvedValue({ ok: false, error: { code: 'forbidden', message: 'worktree not found' } })
    } as unknown as RpcClient
    expect(await loadHostImage({ ...base, client })).toBeNull()
    expect(String(warn.mock.calls[0]?.[0])).toBe(
      `[host-image] no picture for ${path}: the desktop could not resolve it (worktree not found)`
    )
  })
})

describe('agentTextNamesPath', () => {
  const path = '/private/tmp/claude-501/x/scratchpad/tp12-12.png'
  const msg = (role: 'user' | 'assistant', blocks: unknown[]): NativeChatMessage =>
    ({ id: role, role, blocks }) as NativeChatMessage
  it('is true only for assistant text that names the path, not for the Read call itself', () => {
    const read = msg('assistant', [{ type: 'tool-call', name: 'Read', input: { file_path: path } }])
    expect(agentTextNamesPath([read], path)).toBe(false)
    expect(agentTextNamesPath([msg('user', [{ type: 'text', text: `see ${path}` }])], path)).toBe(false)
    expect(agentTextNamesPath([read, msg('assistant', [{ type: 'text', text: `Saved \`${path}\`.` }])], path)).toBe(true)
  })
  it('is false for no messages at all', () => {
    expect(agentTextNamesPath([], path)).toBe(false)
  })
})
