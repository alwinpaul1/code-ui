// The small readings the background-task list draws captions from, split out
// of the derivation to keep it under the line ceiling. Presentation of one
// task's end, nothing about which tasks run.

/** Beyond this a summary is a paragraph, not a caption; drop it rather than
 *  truncate a sentence into something that reads as a different claim. */
const SUMMARY_MAX = 160

/** A notification means the task stopped. Only an explicitly bad status is
 *  shown as a failure — an unrecognised one is reported as merely finished
 *  rather than guessed into an alarm. */
export function isFailureStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase()
  return normalized === 'failed' || normalized === 'error' || normalized === 'failure'
}

export function elapsedSince(startedAt: number | null, now: number): number | null {
  return startedAt === null ? null : Math.max(0, now - startedAt)
}

export function captionOf(summary: string | null): string | undefined {
  if (!summary) {
    return undefined
  }
  const single = summary.replaceAll(/\s+/g, ' ').trim()
  return single.length > 0 && single.length <= SUMMARY_MAX ? single : undefined
}
