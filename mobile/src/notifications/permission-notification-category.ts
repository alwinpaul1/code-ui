import * as Notifications from 'expo-notifications'

/** One button to register. `opensApp` is for the single route that cannot be
 *  answered in place: the tap brings the app up on the session instead. */
export type PromptNotificationCategoryAction = {
  identifier: string
  label: string
  opensApp?: boolean
}

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
 * which is exactly when sharing is correct. A button that opens the app is a
 * different button from one with the same label that does not, so that is in
 * the id too.
 *
 * Returns null rather than throwing: the caller keeps the improved caption and
 * drops only the buttons, which is the right degradation.
 */
const registered = new Set<string>()

export async function ensurePermissionCategory(
  actions: PromptNotificationCategoryAction[]
): Promise<string | null> {
  if (actions.length === 0) {
    return null
  }
  const categoryIdentifier = `codeui-permission-${actions
    .map((a) => (a.opensApp ? `${a.label}→app` : a.label))
    .join('|')}`
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
          // The one exception is the route whose whole job is to open it.
          opensAppToForeground: action.opensApp === true
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
