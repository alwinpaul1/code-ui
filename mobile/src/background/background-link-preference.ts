/** Default ON, and no longer a switch in Settings (2026-09-12): the user's
 *  call was that notifications reaching a closed app is what the feature is,
 *  not an option. Agent notifications remain the one switch; background
 *  delivery rides on them. A stored 'false' from an older build is honoured
 *  no further — the row that wrote it is gone. */
export async function loadBackgroundDeliveryEnabled(): Promise<boolean> {
  return true
}

