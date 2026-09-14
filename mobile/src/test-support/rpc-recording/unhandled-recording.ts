import { captureError } from './recording-values'

let active = false

// Main's detached effects can reject without a caller promise; record that observable failure too.
export function recordUnhandledRejections(
  effect: (name: string, value: unknown) => void
): () => void {
  if (active) {
    throw new Error('Recordings must run sequentially in each process')
  }
  active = true
  // CODE UI: this fork's TypeScript resolves @types/node 22, whose `rawListeners` returns
  // `Function[]` — not callable, so `process.on` below rejects every element. Each listener came
  // back out of the emitter it was registered on, so it takes the emitter's own arguments.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: rawListeners returns the listeners process.on accepted.
  const previous = process.rawListeners('unhandledRejection') as ((...args: unknown[]) => void)[]
  process.removeAllListeners('unhandledRejection')
  process.on('unhandledRejection', (error) => effect('unhandled-rejection', captureError(error)))
  return () => {
    active = false
    process.removeAllListeners('unhandledRejection')
    for (const listener of previous) {
      process.on('unhandledRejection', listener)
    }
  }
}
