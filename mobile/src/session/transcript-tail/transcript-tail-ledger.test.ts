import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetTranscriptTailHandle,
  recordTranscriptTailHandle,
  recordedTranscriptTailHandles,
  resetTranscriptTailLedgerForTests
} from './transcript-tail-ledger'
import { closeTranscriptTailsLeftBehind } from './transcript-tail-ownership'
import { resetTranscriptTailsForTests } from './transcript-tail-session'

beforeEach(async () => {
  resetTranscriptTailLedgerForTests()
  resetTranscriptTailsForTests()
  await AsyncStorage.clear()
})

afterEach(() => {
  resetTranscriptTailLedgerForTests()
})

describe('the terminals an earlier process left behind', () => {
  // The app swiped away with a tail open: the host renamed the tab
  // "Terminal 3", so nothing on the next launch recognised it by title
  // (device, 2026-09-19). The handle, kept in storage, still does.
  it('are closed by the next process when the host still lists them', async () => {
    await recordTranscriptTailHandle('host-1', 'term_old')
    await recordTranscriptTailHandle('host-1', 'term_gone')
    resetTranscriptTailLedgerForTests() // a new process: memory empty, storage kept
    const client = { sendRequest: vi.fn(async () => ({ ok: true, result: {} })) }
    await closeTranscriptTailsLeftBehind(client as never, 'host-1', new Set(['term_old', 'term_user']))
    await Promise.resolve()
    const closed = client.sendRequest.mock.calls.filter((c) => c[0] === 'terminal.closeTab').map((c) => (c[1] as { terminal: string }).terminal)
    expect(closed).toEqual(['term_old'])
    // A handle the host no longer lists names nothing and is forgotten.
    await vi.waitFor(async () => {
      expect(await recordedTranscriptTailHandles('host-1')).toEqual([])
    })
  })

  it('keeps the newest sixteen per host and forgets a closed one', async () => {
    for (let i = 0; i < 20; i += 1) {
      await recordTranscriptTailHandle('host-1', `term_${i}`)
    }
    expect(await recordedTranscriptTailHandles('host-1')).toHaveLength(16)
    expect(await recordedTranscriptTailHandles('host-1')).not.toContain('term_3')
    await forgetTranscriptTailHandle('host-1', 'term_19')
    expect(await recordedTranscriptTailHandles('host-1')).not.toContain('term_19')
    expect(await recordedTranscriptTailHandles('other-host')).toEqual([])
  })

  it('reads a corrupt ledger as empty', async () => {
    await AsyncStorage.setItem('orca:transcriptTailHandles', '{nope')
    expect(await recordedTranscriptTailHandles('host-1')).toEqual([])
  })
})
