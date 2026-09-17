import * as Notifications from 'expo-notifications'

/**
 * Register an action set with the OS and return the id a notification uses to
 * claim it.
 *
 * Android takes actions from a CATEGORY rather than from the notification, so
 * the buttons have to be declared before the banner that wants them. The id is
 * derived from the labels, so two prompts offering the same choices reuse one
 * registration and a prompt offering different ones gets its own.
 *
 * Why the labels and not the sends: the sends are keystrokes, which would put
 * an escape character in a category id, and the labels are what the OS actually
 * draws. Two different prompts with identical labels want identical buttons,
 * which is exactly when sharing is correct.
 *
 * Returns null rather than throwing: the caller keeps the improved caption and
 * drops only the buttons, which is the right degradation.
 */
const registered = new Set<string>()

export async function ensurePermissionCategory(
  actions: { identifier: string; label: string }[]
): Promise<string | null> {
  if (actions.length === 0) {
    return null
  }
  const categoryIdentifier = `codeui-permission-${actions.map((a) => a.label).join('|')}`
  if (registered.has(categoryIdentifier)) {
    return categoryIdentifier
  }
  try {
    await Notifications.setNotificationCategoryAsync(
      categoryIdentifier,
      actions.map((action) => ({
        identifier: action.identifier,
        buttonTitle: action.label,
        options: {
          // Answering is the whole point of the button: it must not need the
          // app brought to the front, and the shade should close on the tap.
          opensAppToForeground: false
        }
      }))
    )
    registered.add(categoryIdentifier)
    return categoryIdentifier
  } catch {
    return null
  }
}

/** Test-only: forget what has been registered with the OS. */
export function resetPermissionCategoriesForTests(): void {
  registered.clear()
}
