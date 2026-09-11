import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  normalizeTerminalSnapshotForReplay,
  scheduleTerminalStreamReplay,
  selectTerminalStreamCaptureSnapshot,
  type TerminalStreamCapture,
  type TerminalStreamCaptureEvent
} from './terminal-stream-capture'

const baseCapture: TerminalStreamCapture = {
  version: 1,
  placeholder: false,
  capturedAt: '2026-09-11T00:00:00.000Z',
  terminal: 'term_x',
  viewport: { cols: 51, rows: 38 },
  cols: 174,
  rows: 67,
  serialized: 'desktop-shaped snapshot',
  events: []
}

describe('selectTerminalStreamCaptureSnapshot', () => {
  it('inits from a resize re-stream that landed before any output', () => {
    const capture: TerminalStreamCapture = {
      ...baseCapture,
      events: [
        { t: 998, type: 'resized', cols: 51, rows: 38, serialized: 'phone-shaped snapshot' },
        { t: 1027, type: 'data', chunk: 'frame' }
      ]
    }
    expect(selectTerminalStreamCaptureSnapshot(capture)).toEqual({
      cols: 51,
      rows: 38,
      serialized: 'phone-shaped snapshot'
    })
  })

  it('keeps the original snapshot when output came first', () => {
    const capture: TerminalStreamCapture = {
      ...baseCapture,
      events: [
        { t: 10, type: 'data', chunk: 'frame' },
        { t: 998, type: 'resized', cols: 51, rows: 38, serialized: 'later re-stream' }
      ]
    }
    expect(selectTerminalStreamCaptureSnapshot(capture)).toEqual({
      cols: 174,
      rows: 67,
      serialized: 'desktop-shaped snapshot'
    })
  })
})

const ESC = ''

describe('scheduleTerminalStreamReplay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('delivers each chunk at its recorded offset, in recorded order', () => {
    const events: TerminalStreamCaptureEvent[] = [
      { t: 0, type: 'data', chunk: 'a' },
      { t: 120, type: 'data', chunk: 'b' },
      { t: 120, type: 'data', chunk: 'c' },
      { t: 130, type: 'resized', cols: 51, rows: 44, serialized: null },
      { t: 900, type: 'data', chunk: 'd' }
    ]
    const written: Array<[number, string]> = []
    const done = vi.fn()
    scheduleTerminalStreamReplay(events, {
      write: (chunk) => written.push([Date.now(), chunk]),
      done
    })
    const start = Date.now()
    vi.advanceTimersByTime(119)
    expect(written.map(([, chunk]) => chunk)).toEqual(['a'])
    vi.advanceTimersByTime(1)
    expect(written.map(([, chunk]) => chunk)).toEqual(['a', 'b', 'c'])
    expect(done).not.toHaveBeenCalled()
    vi.advanceTimersByTime(780)
    expect(written.map(([t, chunk]) => [t - start, chunk])).toEqual([
      [0, 'a'],
      [120, 'b'],
      [120, 'c'],
      [900, 'd']
    ])
    expect(done).toHaveBeenCalledWith({ skippedResizes: 1 })
  })

  it('writes nothing after cancel', () => {
    const write = vi.fn()
    const done = vi.fn()
    const replay = scheduleTerminalStreamReplay(
      [
        { t: 10, type: 'data', chunk: 'a' },
        { t: 20, type: 'data', chunk: 'b' }
      ],
      { write, done }
    )
    vi.advanceTimersByTime(10)
    replay.cancel()
    vi.advanceTimersByTime(100)
    expect(write).toHaveBeenCalledTimes(1)
    expect(done).not.toHaveBeenCalled()
  })
})

describe('normalizeTerminalSnapshotForReplay', () => {
  it('drops normal-buffer scrollback that precedes a live alternate screen', () => {
    const snapshot = `old shell lines\r\n${ESC}[?1049h${ESC}[HTUI frame`
    expect(normalizeTerminalSnapshotForReplay(snapshot)).toBe(`${ESC}[?1049h${ESC}[HTUI frame`)
  })

  it('keeps a snapshot whose alternate screen was already left', () => {
    const snapshot = `${ESC}[?1049hframe${ESC}[?1049lback on the shell`
    expect(normalizeTerminalSnapshotForReplay(snapshot)).toBe(snapshot)
  })

  it('keeps a main-screen snapshot untouched', () => {
    const snapshot = 'plain agent transcript\r\n'
    expect(normalizeTerminalSnapshotForReplay(snapshot)).toBe(snapshot)
  })
})
