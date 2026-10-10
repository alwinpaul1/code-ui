/** The install store's 0..1 download progress as a whole percent, clamped: a
 *  progress event can arrive a hair over 1, or as NaN from a server that sent
 *  no length. Home's download card and About's row both show it. */
export function downloadProgressPercent(progress: number): number {
  if (!Number.isFinite(progress)) {
    return 0
  }
  return Math.round(Math.min(1, Math.max(0, progress)) * 100)
}
