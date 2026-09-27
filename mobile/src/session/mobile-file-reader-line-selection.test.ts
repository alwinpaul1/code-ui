import { describe, expect, it } from 'vitest'
import {
  extendFileReaderLineSelection,
  fileReaderLineSelectionLabel,
  fileReaderLineSelectionRange,
  isFileReaderLineSelected,
  startFileReaderLineSelection,
  fileLinesText
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

describe('copying selected lines as the file holds them', () => {
  it('keeps each line\'s own break in a file that mixes CRLF and LF', () => {
    expect(fileLinesText('a\r\nb\nc\r\nd', { start: 1, end: 3 })).toBe('a\r\nb\nc')
    expect(fileLinesText('a\r\nb\nc\r\nd', { start: 2, end: 4 })).toBe('b\nc\r\nd')
  })

  it('handles the one line of a file, the last line with and without a break, and an empty file', () => {
    expect(fileLinesText('only', { start: 1, end: 1 })).toBe('only')
    expect(fileLinesText('a\nlast', { start: 2, end: 2 })).toBe('last')
    expect(fileLinesText('a\nlast\n', { start: 2, end: 2 })).toBe('last')
    expect(fileLinesText('a\r\nlast\r\n', { start: 2, end: 2 })).toBe('last')
    expect(fileLinesText('a\n\n', { start: 3, end: 3 })).toBe('')
    expect(fileLinesText('', { start: 1, end: 1 })).toBe('')
    expect(fileLinesText('a\nb', { start: 5, end: 6 })).toBe('')
  })

  it('keeps a blank CRLF line blank', () => {
    expect(fileLinesText('a\r\n\r\nb', { start: 2, end: 2 })).toBe('')
    expect(fileLinesText('a\r\n\r\nb', { start: 1, end: 3 })).toBe('a\r\n\r\nb')
  })
})
