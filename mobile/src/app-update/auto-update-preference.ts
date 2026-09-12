/** Background update checks are always on (2026-09-12): the user's call was
 *  that noticing a release without opening the app is what the feature is,
 *  not an option. The About switch is gone; the check registers on launch. */
export async function loadBackgroundUpdateCheckEnabled(): Promise<boolean> {
  return true
}
