import { useEffect, useRef, useState } from 'react'
import { Modal, Pressable, View } from 'react-native'

import { useTheme } from '../theme/theme-context'
import { AlertCard } from '../ui/alert/AlertCard'
import { AppUpdateDialogBody } from './AppUpdateDialogBody'
import { useAppUpdateStore } from './app-update-store'
import { useApkInstallStore } from './apk-install-store'
import { useDialogState } from './app-update-dialog-state'
import {
  claimAppUpdateDialogPresenter,
  releaseAppUpdateDialogPresenter
} from './app-update-dialog-presenter'
import { deferDialogDismiss } from './app-update-dismiss-defer'
import {
  pointerBlockForUpdateDialog,
  UPDATE_DIALOG_TOUCH_SHIELD_FILL,
  updateDialogShowsCard,
  updateDialogTouchShieldStyle,
  useAppUpdateTouchShield
} from './use-app-update-touch-shield'

// One alert for the whole update journey, after UIAlertController by way of
// BitChord's UpdateAvailableDialog: a fixed 270 card on a flat 28% scrim,
// action rows stacked under the message, the release notes as markdown in a
// capped scroller. The same card morphs through checking → latest / available
// → ready → error rather than stacking banners, the shape Orca desktop's
// UpdateCard has. A download shows nothing at all (2026-09-14): it runs in the
// store and the card returns on its own when it is done. Transient states
// (checking, up to date) only show for a user-initiated "Check for updates".
//
// This file owns the window: the Modal, the touch shield behind the card and
// its tail, and what a tap on the scrim means. The card is ui/alert/AlertCard;
// what it says is AppUpdateDialogBody.

export function AppUpdateDialog() {
  const { colors, space } = useTheme()
  // Why: Home and About each mount this dialog, and a router stack keeps both
  // screens alive, so without a single presenter one store change opens two
  // modals and dismissing the front one leaves the second over the list.
  const owner = useRef({}).current
  const [presenting, setPresenting] = useState(() => claimAppUpdateDialogPresenter(owner))
  useEffect(() => {
    // Re-claim on mount: the previous holder may have unmounted since render.
    setPresenting(claimAppUpdateDialogPresenter(owner))
    return () => releaseAppUpdateDialogPresenter(owner)
  }, [owner])

  const state = useDialogState()
  const visible = presenting && state.kind !== 'hidden'
  const shielded = useAppUpdateTouchShield(visible)
  const pointerBlock = pointerBlockForUpdateDialog({ dialogVisible: visible, shielded })
  const showCard = updateDialogShowsCard(visible)
  // The scrim is "Later" wherever the card has a Later / Not now / OK row.
  // Not while a download is being installed, and not on "Update downloaded":
  // Later there throws the ~170 MB file away, which a stray tap beside the
  // card must not do.
  const dismissible =
    state.kind === 'available' ||
    state.kind === 'up-to-date' ||
    state.kind === 'check-failed' ||
    state.kind === 'failed'

  const dismiss = () => {
    if (!dismissible) {
      return
    }
    // Why deferred: closing here removes this Modal's own Android window while
    // the system is still delivering the press, and the release then lands on
    // the screen behind. See app-update-dismiss-defer.ts.
    deferDialogDismiss(closeDialog)
  }

  const closeDialog = () => {
    if (state.kind === 'available') {
      void useAppUpdateStore.getState().dismiss()
    } else if (state.kind === 'failed') {
      useApkInstallStore.getState().reset()
    } else {
      useAppUpdateStore.setState({ userInitiated: false })
    }
  }

  if (!visible && !shielded) {
    return null
  }

  // Why the card unmounts the instant the dialog closes, with no exit
  // animation: recorded on a Galaxy S23 running 0.3.2. The fading rounded
  // sheet sat on alwinpaul1/code-ui and looked like a press. The shield tail
  // still eats leftover presses; the card is already gone.
  const dimmerPress = pointerBlock === 'backdrop' && dismissible ? dismiss : () => {}
  switch (pointerBlock) {
    case 'backdrop':
    case 'full':
    case 'none':
      break
    default: {
      const _exhaustive: never = pointerBlock
      return _exhaustive
    }
  }

  return (
    <Modal transparent visible statusBarTranslucent onRequestClose={dismiss}>
      <View style={{ flex: 1 }}>
        {/* The scrim and the touch shield are one view, and it is never
            animated: native-driver opacity on a window-filling view lets a
            held press fall through the Modal (Galaxy S23, 0.3.0). It flips
            from the 28% dim to the 1% shield fill the frame the card goes. */}
        <Pressable
          // A TalkBack "button" only where a tap does something; in the
          // states the scrim does not close, it is not an element at all.
          accessible={pointerBlock === 'backdrop' && dismissible}
          accessibilityRole={pointerBlock === 'backdrop' && dismissible ? 'button' : undefined}
          accessibilityLabel={pointerBlock === 'backdrop' && dismissible ? 'Dismiss' : undefined}
          onPress={dimmerPress}
          pointerEvents="auto"
          style={[
            updateDialogTouchShieldStyle(),
            { backgroundColor: showCard ? colors.alertScrim : UPDATE_DIALOG_TOUCH_SHIELD_FILL }
          ]}
        />
        {showCard ? (
          <View
            pointerEvents={pointerBlock === 'full' ? 'none' : 'box-none'}
            style={{
              flex: 1,
              justifyContent: 'center',
              alignItems: 'center',
              padding: space.xl
            }}
          >
            <AlertCard morphKey={state.kind}>
              <AppUpdateDialogBody state={state} onDismiss={dismiss} />
            </AlertCard>
          </View>
        ) : null}
      </View>
    </Modal>
  )
}

export { useAppUpdateDialogVisible } from './app-update-dialog-state'
