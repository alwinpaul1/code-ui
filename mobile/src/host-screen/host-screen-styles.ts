import type { Theme } from '../theme/theme-context'
import { hostScreenPrimaryStyles } from './host-screen-primary-styles'
import { hostScreenSecondaryStyles } from './host-screen-secondary-styles'

export function hostScreenStyles(theme: Theme) {
  return {
    ...hostScreenPrimaryStyles(theme),
    ...hostScreenSecondaryStyles(theme)
  }
}
