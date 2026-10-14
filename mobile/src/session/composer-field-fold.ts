/** The field's fold while the recording row comes and goes: `swap` 0 is the idle composer, 1 the
 *  row fully up; `fieldHeight` is the last height measured with the field fully open, -1 before
 *  the first layout.
 *
 *  Idle, the field has no height of its own: it grows with its draft like before the recording row
 *  (0.9.140 pinned it to the last measured height, so a draft grown by dictation was cropped to a
 *  line, and a height measured while folded left no field at all; the phone, 2026-10-14). Only
 *  while the row comes up or goes away does it fold from the remembered height. */
export function composerFieldFoldStyle(
  swap: number,
  fieldHeight: number
): { opacity: number; height: number | 'auto' } {
  'worklet'
  const p = Math.min(1, Math.max(0, swap))
  // 'auto', not a missing key: Reanimated keeps the last height it applied when a key is dropped,
  // which would leave the fold's final frame pinned.
  if (p === 0 || fieldHeight < 0) {
    return { opacity: 1 - p, height: 'auto' }
  }
  return { opacity: 1 - p, height: fieldHeight * (1 - p) }
}

/** The height the fold remembers after a layout of the field's content: only a layout taken with
 *  the field fully open counts, so one taken mid-fold (or folded, at 0) never becomes its size. */
export function nextComposerFieldHeight(previous: number, measured: number, swap: number): number {
  return swap === 0 ? measured : previous
}
