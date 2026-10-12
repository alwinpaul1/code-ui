import { TextInput } from 'react-native'

/** Whether any React Native text field holds focus, as React Native's own
 *  record has it. Its own module so a test can say what is focused. */
export function anyTextFieldFocused(): boolean {
  return TextInput.State.currentlyFocusedInput() != null
}
