// One driver at a time per terminal. The picker reader, the picker apply, and
// the /status poll all TYPE into the same PTY character by character; two of
// them overlapping once produced "/model msotdaetlu" (model + status
// interleaved), which Codex then answered as a chat message. Every driver
// takes this lock around its keystrokes.
const tails = new Map<string, Promise<void>>()

export function withCodexTerminalLock<T>(handle: string, run: () => Promise<T>): Promise<T> {
  const previous = tails.get(handle) ?? Promise.resolve()
  const settled = previous.then(run, run)
  const tail = settled.then(
    () => undefined,
    () => undefined
  )
  tails.set(handle, tail)
  void tail.then(() => {
    if (tails.get(handle) === tail) {
      tails.delete(handle)
    }
  })
  return settled
}

export function resetCodexTerminalLockForTests(): void {
  tails.clear()
}
