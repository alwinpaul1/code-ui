import { useSyncExternalStore } from 'react'

/**
 * Which mounted copy of the update dialog is allowed to show it.
 *
 * Why this is needed: an Expo Router stack keeps the screen underneath mounted.
 * Home mounts the dialog (it owns update polling) and About mounts its own, so
 * opening About puts two copies of the same dialog on the tree, both reading
 * the same store. One store change then opened two modals, and dismissing the
 * top one left the second standing over the About list.
 *
 * Why the LAST claim wins, not the first: "first claim wins" put the dialog on
 * the screen underneath. Reported 2026-09-18 — tap Check for updates on About,
 * nothing appears; go back to Home, the banner is there. About is pushed over
 * Home, so Home had mounted first and held the claim, and the dialog opened on
 * Home's copy behind About. The screen a user can see is the one on top, which
 * is the most recently mounted.
 *
 * Why a subscribable stack rather than a flag: each dialog copy keeps
 * "presenting" as React state, so the copy that LOSES the claim has to be told
 * or it goes on presenting alongside the winner — the double modal this exists
 * to prevent, reached from the other side. Unmounting pops the owner and the
 * one beneath presents again, so leaving About hands the dialog back to Home.
 */

const stack: object[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function top(): object | null {
  return stack.length === 0 ? null : stack[stack.length - 1]!
}

/** Put this owner on top. Re-claiming moves it to the top; it never duplicates. */
export function claimAppUpdateDialogPresenter(owner: object): boolean {
  const before = top()
  const index = stack.indexOf(owner)
  if (index !== -1) {
    stack.splice(index, 1)
  }
  stack.push(owner)
  if (before !== owner) {
    emit()
  }
  return true
}

/** Take this owner out wherever it sits. A release from a non-member is ignored. */
export function releaseAppUpdateDialogPresenter(owner: object): void {
  const before = top()
  const index = stack.indexOf(owner)
  if (index === -1) {
    return
  }
  stack.splice(index, 1)
  if (before !== top()) {
    emit()
  }
}

export function isAppUpdateDialogPresenter(owner: object): boolean {
  return top() === owner
}

export function subscribeAppUpdateDialogPresenter(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Whether this owner is the copy on top, re-rendering whenever that changes. */
export function useAppUpdateDialogPresenting(owner: object): boolean {
  return useSyncExternalStore(
    subscribeAppUpdateDialogPresenter,
    () => isAppUpdateDialogPresenter(owner),
    () => false
  )
}

/** Test-only. */
export function resetAppUpdateDialogPresenterForTests(): void {
  stack.length = 0
  listeners.clear()
}
