import { Button } from '../ui/Button'

/**
 * What the banner offers once authentication has failed: reconnect, re-pair, or drop the pairing.
 *
 * Its own file because its `.web` sibling offers Re-pair alone: the page hands `/pair-scan` to the
 * shell, but its `forceReconnect` is null (`client-context.web.tsx`) and removal refuses
 * (`page-host-removal-refusal.ts`).
 */
export function AuthFailedBannerActions({
  canRetry,
  onRetry,
  onRepair,
  onRemove
}: {
  canRetry: boolean
  onRetry: () => void
  onRepair: () => void
  onRemove: () => void
}) {
  return (
    <>
      {canRetry && <Button label="Retry" size="sm" variant="primary" onPress={onRetry} />}
      <Button label="Re-pair" size="sm" variant="secondary" onPress={onRepair} />
      <Button label="Remove" size="sm" variant="ghost" onPress={onRemove} />
    </>
  )
}
