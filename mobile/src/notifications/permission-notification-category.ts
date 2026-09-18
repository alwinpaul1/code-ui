import * as Notifications from 'expo-notifications'

/** One button to register. With `textInput` it is a reply field (Android
 *  RemoteInput): the user types in the shade and the app never opens. */
export type PromptNotificationCategoryAction = {
  identifier: string
  label: string
  textInput?: { placeholder: string }
}

/**
 * Register an action set with the OS and return the id a notification uses to
 * claim it.
 *
 * Android takes actions from a CATEGORY rather than from the notification, so
 * the buttons have to be declared before the banner that wants them. The id is
 * derived from what each button IS — its identifier, its label, and whether
 * it is a reply field — so two prompts offering the same buttons reuse one
 * registration and a prompt offering different ones gets its own.
 *
 * Why the labels and not the sends: the sends are keystrokes, which would put
 * an escape character in a category id, and the labels are what the OS actually
 * draws. Why the identifiers as well: the OS hands back only the identifier
 * when a button is tapped, and it is the identifier that says which path
 * answers it. Built from labels alone, a question whose options read Allow /
 * Deny inherited the permission's category and its `permission:0` buttons,
 * which the question path does not answer — dead and silent (2026-09-18).
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
    .map((a) => `${a.identifier}=${a.textInput ? 'reply:' : ''}${a.label}`)
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
        ...(action.textInput
          ? {
              textInput: {
                // iOS only; Android draws its own send button.
                submitButtonTitle: 'Send',
                placeholder: action.textInput.placeholder
              }
            }
          : {}),
        options: {
          // Answering is the whole point of the button: it must never need the
          // app brought to the front, and the shade should close on the tap.
          // A reply field is answered in the shade too. (2026-09-18: "user can
          // reply directly from the notification, don't open the app".)
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
