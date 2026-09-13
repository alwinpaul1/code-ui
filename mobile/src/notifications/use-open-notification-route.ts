import { useCallback } from 'react'
import { useRouter } from 'expo-router'
import { hydrateAppUpdateState, useAppUpdateStore } from '../app-update/app-update-store'
import { hostStackHostRoute } from '../navigation/host-stack-navigation'
import { useOpenHostStackRoute } from '../navigation/use-open-host-stack-route'
import {
  notificationCredentialRecoveryRoute,
  type NotificationNavigationTarget
} from './notification-routing'

export function useOpenNotificationRoute(): (target: NotificationNavigationTarget) => void {
  const openHostStackRoute = useOpenHostStackRoute()
  const router = useRouter()

  return useCallback(
    (target) => {
      const recoveryRoute = notificationCredentialRecoveryRoute(target)
      if (recoveryRoute) {
        router.push(recoveryRoute)
        return
      }
      if (target.sessionTarget) {
        openHostStackRoute(target.hostId, target.sessionTarget)
        return
      }
      router.push(hostStackHostRoute(target.hostId))
    },
    [openHostStackRoute, router]
  )
}

/** Where a Code UI update notification lands: Home, which mounts the update
 *  dialog. `navigate` rather than `push` so a tap from deep in a host stack
 *  returns to the existing Home instead of stacking a second one. */
export function useOpenAppUpdateNotification(): () => void {
  const router = useRouter()
  return useCallback(() => {
    router.navigate('/')
    // The tap IS the person asking now, so it bypasses the 30-minute throttle
    // that otherwise left Home showing no banner (2026-09-13). What the
    // background check already found is restored first: the forced check
    // flips the store to "checking" before Home mounts, which is exactly when
    // Home's own restore declines to run, and offline the tap then ended on
    // an error with no banner at all.
    void hydrateAppUpdateState().then(() =>
      useAppUpdateStore.getState().checkForUpdate({ force: true })
    )
  }, [router])
}
