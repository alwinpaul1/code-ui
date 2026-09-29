import type { ReactNode } from 'react'
import type { HomeBodyKind } from './home-body-kind'
import { MobileHomeEmptyState } from './MobileHomeEmptyState'

// Why its own component: the choice between "nothing yet", "Connect your
// desktop" and the host list is the whole bug in the 2026-09-29 launch flash,
// and a render test can only reach it here, not inside the 200-line screen.
export function MobileHomeBody(props: {
  kind: HomeBodyKind
  pair: {
    bottomInset: number
    contentMaxWidth: number
    isWideLayout: boolean
    onPairDesktop: () => void
  }
  hostList: ReactNode
}) {
  if (props.kind === 'loading') {
    return null
  }
  if (props.kind === 'pair') {
    return <MobileHomeEmptyState {...props.pair} />
  }
  return <>{props.hostList}</>
}
