/**
 * Which mounted copy of the update dialog is allowed to show it.
 *
 * Why this is needed: an Expo Router stack keeps the screen underneath mounted.
 * Home mounts the dialog (it owns update polling) and About mounts its own, so
 * opening About puts two copies of the same dialog on the tree, both reading
 * the same store. One store change then opened two modals, and dismissing the
 * top one left the second standing over the About list.
 *
 * First claim wins, and it is held until that screen unmounts, at which point
 * another mounted screen may take over — otherwise leaving Home would leave
 * nothing able to tell the user an update exists.
 */

let holder: object | null = null

/** True when this owner may render the dialog. Re-claiming is idempotent. */
export function claimAppUpdateDialogPresenter(owner: object): boolean {
  if (holder === null || holder === owner) {
    holder = owner
    return true
  }
  return false
}

/** Give the dialog up on unmount. A release from a non-holder is ignored. */
export function releaseAppUpdateDialogPresenter(owner: object): void {
  if (holder === owner) {
    holder = null
  }
}

/** Test-only. */
export function resetAppUpdateDialogPresenterForTests(): void {
  holder = null
}
