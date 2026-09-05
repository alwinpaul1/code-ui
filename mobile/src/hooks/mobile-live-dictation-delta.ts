const BACKSPACE = '\u007f'

/**
 * Bytes that turn the text already typed on a terminal line (`previous`) into
 * `next`: backspaces for the part that changed, then the new tail. Live
 * transcription revises the last few words as it goes, so most updates are a
 * handful of backspaces and a word, never a line clear.
 */
export function liveDictationDelta(previous: string, next: string): string {
  const prev = Array.from(previous)
  const target = Array.from(next)
  let common = 0
  while (common < prev.length && common < target.length && prev[common] === target[common]) {
    common += 1
  }
  return BACKSPACE.repeat(prev.length - common) + target.slice(common).join('')
}
