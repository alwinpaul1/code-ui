type DismissibleUpdate = {
  version: string
  buildNumber?: string | null
  updateUrl?: string | null
}

function baseUpdateId(update: DismissibleUpdate): string {
  return update.buildNumber ? `${update.version}:${update.buildNumber}` : update.version
}

function legacyUpdateId(update: DismissibleUpdate): string {
  return baseUpdateId(update)
}

export function getUpdateDismissalId(update: DismissibleUpdate): string {
  const actionability = update.updateUrl ? 'actionable' : 'informational'
  return `${baseUpdateId(update)}:${actionability}`
}

export function isUpdateDismissed(
  dismissedUpdateId: string | null,
  update: DismissibleUpdate
): boolean {
  if (!dismissedUpdateId) {
    return false
  }
  if (dismissedUpdateId === getUpdateDismissalId(update)) {
    return true
  }
  // Why: ids shipped before actionability existed should keep suppressing the
  // same no-CTA banner, but must not hide a later App Store/TestFlight URL.
  return !update.updateUrl && dismissedUpdateId === legacyUpdateId(update)
}
