// One driver at a time per terminal. The picker reader, the picker apply, and
// the /status poll all TYPE into the same PTY character by character; two of
// them overlapping once produced "/model msotdaetlu" (model + status
// interleaved), which Codex then answered as a chat message. Every driver
// takes this lock around its keystrokes.
const tails = new Map<string, Promise<void>>()

export function withCodexTerminalLock<T>(handle: string, run: () => Promise<T>): Promise<T> {
  const previous = tails.get(handle) ?? Promise.resolve()
  const settled = previous.then(run, run)
  // Let go in the first reaction to the run settling, ahead of anything the
  // caller chains on it, so a refresh the caller asks for once the lock is
  // released finds it released (isCodexTerminalLocked).
  const release = (): void => {
    if (tails.get(handle) === tail) {
      tails.delete(handle)
    }
  }
  const tail: Promise<void> = settled.then(release, release)
  tails.set(handle, tail)
  return settled
}

/** A driver holds or waits on this terminal: the screen it is reading and
 *  typing into is its own work in progress (a picker it opened), not state the
 *  chat should report. */
export function isCodexTerminalLocked(handle: string): boolean {
  return tails.has(handle)
}

export function resetCodexTerminalLockForTests(): void {
  tails.clear()
}
