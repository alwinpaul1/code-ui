import { Button } from '../ui/Button'
import { Txt } from '../ui/Txt'

/**
 * The page offers Re-pair alone: its push of `/pair-scan` is handed to the shell
 * (`route-handoff.web.ts`), which opens the native scan screen. Retry and Remove are inert here —
 * `forceReconnect` is null (`client-context.web.tsx`) and removal refuses
 * (`page-host-removal-refusal.ts`) — so a line names the app for those two instead.
 */
export function AuthFailedBannerActions({
  onRepair
}: {
  canRetry: boolean
  onRetry: () => void
  onRepair: () => void
  onRemove: () => void
}) {
  return (
    <>
      <Button label="Re-pair" size="sm" variant="secondary" onPress={onRepair} />
      {/* Secondary text, so the page's pointer to the app does not read as a second control. */}
      <Txt variant="label" tone="secondary" style={{ flexShrink: 1, alignSelf: 'center' }}>
        Reconnect or remove this host from the Orca app.
      </Txt>
    </>
  )
}
