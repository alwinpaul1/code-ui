import type { ReactNode } from 'react'
import { useDrawerMountLifecycle } from './use-drawer-mount-lifecycle'
import { MountedBottomDrawer } from './mounted-bottom-drawer'

type Props = {
  visible: boolean
  onClose: () => void
  onAfterClose?: () => void
  children: ReactNode
  dragContentToDismiss?: boolean
  contentScrollable?: boolean
  // Why: smart-source (and similar) need a stable outer frame so a docked
  // TextInput can sit above the keyboard while results reflow in flex space
  // above it — content-sized sheets make that field ride every list change.
  fillAvailable?: boolean
  // Why: pin an outer content-sized sheet under an inner fill picker without
  // letting it take touches, draw a second backdrop, or keyboard-lift.
  interactive?: boolean
  /** Opens part way and drags up to full screen, like the Claude app's sheets. */
  expandable?: boolean
  /** Pinned above the content, outside its scroll: a title that never scrolls away. */
  header?: ReactNode
  zIndex?: number
  /** For a sheet with nothing to type: sends the keyboard away as the sheet
   *  opens, instead of leaving the sheet under it until its window takes
   *  focus (use-keyboard-dismissed-on-open.ts). Never for a sheet that
   *  focuses a field of its own. */
  dismissKeyboardOnOpen?: boolean
}

export function BottomDrawer({
  visible,
  onClose,
  onAfterClose,
  children,
  dragContentToDismiss = true,
  contentScrollable = true,
  fillAvailable = false,
  interactive = true,
  expandable = false,
  header,
  zIndex,
  dismissKeyboardOnOpen = false
}: Props) {
  const { mounted: resolvedMounted, handleHidden } = useDrawerMountLifecycle(visible, onAfterClose)

  // Why: hidden drawers are rendered by parent screens even while closed; keep
  // their Reanimated/Gesture setup out of hot paths like commit-message typing.
  if (!resolvedMounted) {
    return null
  }

  return (
    <MountedBottomDrawer
      visible={visible}
      onClose={onClose}
      onHidden={handleHidden}
      dragContentToDismiss={dragContentToDismiss}
      contentScrollable={contentScrollable}
      fillAvailable={fillAvailable}
      interactive={interactive}
      expandable={expandable}
      header={header}
      zIndex={zIndex}
      dismissKeyboardOnOpen={dismissKeyboardOnOpen}
    >
      {children}
    </MountedBottomDrawer>
  )
}
