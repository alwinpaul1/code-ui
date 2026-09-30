import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatSessionOptionRecord } from '../../../src/shared/native-chat-session-option-state'

// A store whose writes can be held open, so a read can be made to race one,
// and made to fail, so a failed write can sit in front of a read. The same
// harness as native-chat-pending-echo-barrier.test.ts.
const store = new Map<string, string>()
let holdWrites: (() => void) | null = null
let writeGate: Promise<void> = Promise.resolve()
let failWrites = false

function openWriteGate(): void {
  writeGate = new Promise<void>((resolve) => {
    holdWrites = resolve
  })
}

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      await writeGate
      if (failWrites) {
        throw new Error('Database or disk is full (code 13 SQLITE_FULL)')
      }
      store.set(key, value)
    },
    removeItem: async (key: string) => {
      await writeGate
      if (failWrites) {
        throw new Error('Database or disk is full (code 13 SQLITE_FULL)')
      }
      store.delete(key)
    }
  }
}))

import { readNativeChatDraft, writeNativeChatDraft } from './native-chat-drafts'
import { readNativeChatImagePreviews, writeNativeChatImagePreviews } from './native-chat-image-previews'
import { readSessionOptionRecord, writeSessionOptionRecord } from './session-option-records'

beforeEach(() => {
  store.clear()
  holdWrites = null
  writeGate = Promise.resolve()
  failWrites = false
})

// A chat's composer is written to disk on a debounce, and the send clears it
// with an empty write. Leaving the project and coming back reads the draft
// again, and that read can start while those writes are still in flight. The
// hook adopts what the read returns as the draft and writes it back, which is
// the 2026-09-13 "sent text hydrated back and glued to the next message".
describe('reopening a chat while its draft is still being written', () => {
  it('does not bring back a draft the send already erased', async () => {
    await writeNativeChatDraft('scope', 'old text')

    openWriteGate()
    const typed = writeNativeChatDraft('scope', 'typed more')
    const erased = writeNativeChatDraft('scope', '')
    const reopened = readNativeChatDraft('scope')
    holdWrites?.()
    await Promise.all([typed, erased])

    expect(await reopened).toBeNull()
  })

  it('reads back the last draft typed, not the one before it', async () => {
    await writeNativeChatDraft('scope', 'old text')

    openWriteGate()
    const typed = writeNativeChatDraft('scope', 'typed more')
    const reopened = readNativeChatDraft('scope')
    holdWrites?.()
    await typed

    expect(await reopened).toBe('typed more')
  })

  it('still answers, with what storage holds, after the write in front of it failed', async () => {
    await writeNativeChatDraft('scope', 'old text')

    openWriteGate()
    failWrites = true
    const failed = writeNativeChatDraft('scope', 'typed more')
    const reopened = readNativeChatDraft('scope')
    holdWrites?.()
    await expect(failed).rejects.toThrow('SQLITE_FULL')

    await expect(reopened).resolves.toBe('old text')
  })

  it('reads nothing for a scope never written, and waits on no other scope', async () => {
    openWriteGate()
    const other = writeNativeChatDraft('other', 'typed elsewhere')
    await expect(readNativeChatDraft('scope')).resolves.toBeNull()
    holdWrites?.()
    await other
  })
})

// The effort and toggle picks are restored from this record when the chat
// comes back; a read that beats the write restores the pick before the last.
describe('reopening a chat while its option picks are still being written', () => {
  const record = (effort: string): NativeChatSessionOptionRecord => ({
    agent: 'claude',
    valuesByModel: { opus: { effort: { value: effort, source: 'dispatched' } } }
  })
  const effortRead = (read: Awaited<ReturnType<typeof readSessionOptionRecord>>): unknown =>
    read.status === 'record' ? read.record.valuesByModel.opus?.effort?.value : read.status

  it('restores the effort picked last, not the one before it', async () => {
    await writeSessionOptionRecord('scope', record('high'))

    openWriteGate()
    const picked = writeSessionOptionRecord('scope', record('max'))
    const reopened = readSessionOptionRecord('scope')
    holdWrites?.()
    await picked

    expect(effortRead(await reopened)).toBe('max')
  })

  it('still answers after the write in front of it failed', async () => {
    await writeSessionOptionRecord('scope', record('high'))

    openWriteGate()
    failWrites = true
    const failed = writeSessionOptionRecord('scope', record('max'))
    const reopened = readSessionOptionRecord('scope')
    holdWrites?.()
    await expect(failed).rejects.toThrow('SQLITE_FULL')

    // A record, not a refusal: the write in front failed, the read did not.
    expect(effortRead(await reopened)).toBe('high')
  })
})

// A chat's photo previews are removed from disk when the map empties; a read
// that beats the removal brings a retired picture back.
describe('reopening a chat while its photo previews are still being written', () => {
  it('does not bring back previews the last write removed', async () => {
    await writeNativeChatImagePreviews('session', { 'row-1': ['file:///a1.jpg'] })

    openWriteGate()
    const removed = writeNativeChatImagePreviews('session', {})
    const reopened = readNativeChatImagePreviews('session')
    holdWrites?.()
    await removed

    expect(await reopened).toBeNull()
  })

  it('still answers after the write in front of it failed', async () => {
    await writeNativeChatImagePreviews('session', { 'row-1': ['file:///a1.jpg'] })

    openWriteGate()
    failWrites = true
    const failed = writeNativeChatImagePreviews('session', { 'row-1': ['file:///a1.jpg'], 'row-2': ['file:///a2.jpg'] })
    const reopened = readNativeChatImagePreviews('session')
    holdWrites?.()
    await expect(failed).rejects.toThrow('SQLITE_FULL')

    expect(await reopened).toEqual({ 'row-1': ['file:///a1.jpg'] })
  })
})
