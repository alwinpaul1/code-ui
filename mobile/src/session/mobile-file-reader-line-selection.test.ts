import { describe, expect, it } from 'vitest'
import {
  extendFileReaderLineSelection,
  fileReaderLineSelectionLabel,
  fileReaderLineSelectionRange,
  isFileReaderLineSelected,
  startFileReaderLineSelection
} from './mobile-file-reader-line-selection'

describe('starting a line selection with a long-press', () => {
  it('selects just the pressed line', () => {
    expect(startFileReaderLineSelection(10)).toEqual({ anchor: 10, focus: 10 })
  })

  it('selects the first line the same way as any other', () => {
    expect(fileReaderLineSelectionRange(startFileReaderLineSelection(1))).toEqual({
      start: 1,
      end: 1
    })
  })
})

describe('extending a selection with a tap', () => {
  it('grows the range downward, keeping the long-pressed line as the anchor', () => {
    const selection = extendFileReaderLineSelection(startFileReaderLineSelection(10), 20)
    expect(fileReaderLineSelectionRange(selection)).toEqual({ start: 10, end: 20 })
  })

  it('grows upward too — the anchor is not always the smaller number', () => {
    const selection = extendFileReaderLineSelection(startFileReaderLineSelection(20), 10)
    expect(fileReaderLineSelectionRange(selection)).toEqual({ start: 10, end: 20 })
  })

  it('collapses back to one line when the tapped line is the anchor itself', () => {
    const selection = extendFileReaderLineSelection(startFileReaderLineSelection(10), 10)
    expect(fileReaderLineSelectionRange(selection)).toEqual({ start: 10, end: 10 })
  })

  it('treats extending nothing as starting fresh, so the view can wire the handler unconditionally', () => {
    expect(fileReaderLineSelectionRange(extendFileReaderLineSelection(null, 5))).toEqual({
      start: 5,
      end: 5
    })
  })
})

describe('reading the range back out', () => {
  it('is null with no selection', () => {
    expect(fileReaderLineSelectionRange(null)).toBeNull()
  })
})

describe('telling whether a given line is inside the selection', () => {
  it('includes both ends of a range', () => {
    const selection = extendFileReaderLineSelection(startFileReaderLineSelection(10), 20)
    expect(isFileReaderLineSelected(selection, 10)).toBe(true)
    expect(isFileReaderLineSelected(selection, 20)).toBe(true)
    expect(isFileReaderLineSelected(selection, 15)).toBe(true)
  })

  it('excludes lines just outside the range', () => {
    const selection = extendFileReaderLineSelection(startFileReaderLineSelection(10), 20)
    expect(isFileReaderLineSelected(selection, 9)).toBe(false)
    expect(isFileReaderLineSelected(selection, 21)).toBe(false)
  })

  it('reports nothing selected when there is no selection', () => {
    expect(isFileReaderLineSelected(null, 1)).toBe(false)
  })
})

describe('the action-bar label', () => {
  it('reads singular for one line', () => {
    expect(fileReaderLineSelectionLabel({ start: 7, end: 7 })).toBe('Ask about line 7')
  })

  it('reads as a span for a range, low to high', () => {
    expect(fileReaderLineSelectionLabel({ start: 10, end: 20 })).toBe('Ask about lines 10–20')
  })
})
