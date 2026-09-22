/** What the background-owned client does with an OS revival signal.
 *  Network changes are owned by the process-level watcher, which nudges every
 *  link once. Forwarding them here as well queued a second relay replace that
 *  finished after the screen was open again (device, 2026-09-22). */
export function forwardBackgroundClientRevival(
  reason: 'app-resume' | 'network-change',
  notify: (reason: 'app-resume' | 'network-change') => void
): void {
  if (reason === 'network-change') {
    return
  }
  notify(reason)
}
