/** What a scrolling segment needs to offer pull-to-refresh: the hub's
 *  refresh callback and whether it is still in flight. */
export type MobilePullToRefresh = {
  refreshing: boolean
  onRefresh: () => void
}
