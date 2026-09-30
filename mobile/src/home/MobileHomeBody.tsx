import type { ReactNode } from 'react'
import type { HomeBodyKind } from './home-body-kind'
import { MobileHomeCatalogFailedState } from './MobileHomeCatalogFailedState'
import { MobileHomeEmptyState } from './MobileHomeEmptyState'

// Why its own component: the choice between "nothing yet", "Connect your
// desktop", "couldn't read your desktops" and the host list is the whole bug in
// the 2026-09-29 launch flash, and a render test can only reach it here, not
// inside the 200-line screen.
export function MobileHomeBody(props: {
  kind: HomeBodyKind
  pair: {
    bottomInset: number
    contentMaxWidth: number
    isWideLayout: boolean
    onPairDesktop: () => void
  }
  /** Re-runs the paired-host read from the failed-read body; settles when it does. */
  onRetryRead: () => Promise<void>
  hostList: ReactNode
}) {
  switch (props.kind) {
    case 'loading':
      return null
    case 'pair':
      return <MobileHomeEmptyState {...props.pair} />
    case 'failed':
      return (
        <MobileHomeCatalogFailedState
          bottomInset={props.pair.bottomInset}
          contentMaxWidth={props.pair.contentMaxWidth}
          isWideLayout={props.pair.isWideLayout}
          onRetry={props.onRetryRead}
        />
      )
    case 'hosts':
      return <>{props.hostList}</>
    default: {
      // A new kind must be placed here, not fall through to the host list.
      const unhandled: never = props.kind
      return unhandled
    }
  }
}
