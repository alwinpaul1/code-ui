// The pure fold behind the update dialog: the two stores' values in, one
// dialog state out. No store or native imports, so the machine is testable on
// its own.

export type DialogState =
  | { kind: 'hidden' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'check-failed' }
  | { kind: 'available' }
  | { kind: 'installing' }
  | { kind: 'ready' }
  | { kind: 'failed'; error: string }

export type DialogStateInputs = {
  status: string
  latestVersion: string | null
  userInitiated: boolean
  phase: string
  error: string | null
}

export function resolveDialogState(inputs: DialogStateInputs): DialogState {
  const { status, latestVersion, userInitiated, phase, error } = inputs
  // A download shows NO dialog: tapping "Download" sends it to the background,
  // and the install dialog returns on its own once it finishes (the user's
  // instruction 2026-09-14 — a downloading popup that trapped the app). The
  // download runs in the store regardless of what is on screen.
  if (phase === 'downloading') {
    return { kind: 'hidden' }
  }
  if (phase === 'installing') {
    return { kind: 'installing' }
  }
  if (phase === 'ready') {
    return { kind: 'ready' }
  }
  if (phase === 'failed') {
    return { kind: 'failed', error: error ?? 'Something went wrong.' }
  }
  if (status === 'available' && latestVersion) {
    return { kind: 'available' }
  }
  if (userInitiated && status === 'checking') {
    return { kind: 'checking' }
  }
  if (userInitiated && status === 'up-to-date') {
    return { kind: 'up-to-date' }
  }
  if (userInitiated && status === 'error') {
    return { kind: 'check-failed' }
  }
  return { kind: 'hidden' }
}
