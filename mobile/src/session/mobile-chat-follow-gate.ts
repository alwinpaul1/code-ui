/**
 * Decides whether a content-size change should pull the chat list to the live
 * edge. Only new content may: a size change with no new data is a re-measure
 * — text selection handles appearing, a pinch changing the font size — and
 * following on those yanked the reader to the newest message the moment they
 * pressed and held a sentence, before the copy toolbar could even appear
 * (reported 2026-09-12). Pure, so the list's timing never enters a test.
 */
export type ChatFollowGate = {
  /** Call whenever the list's data changes identity. */
  noteData: (key: unknown) => void
  /** Called on every content-size change; true when the list should follow.
   *  Consumes the pending data change so one change means one follow. While
   *  a finger is down (`holding`) nothing follows and the change stays
   *  pending: a tap lets it through on release, a long-press turns following
   *  off before then. */
  shouldFollow: (following: boolean, holding?: boolean) => boolean
}

export function createChatFollowGate(): ChatFollowGate {
  let lastKey: unknown = Symbol('unset')
  let pending = false
  return {
    noteData(key) {
      if (key !== lastKey) {
        lastKey = key
        pending = true
      }
    },
    shouldFollow(following, holding = false) {
      if (holding) {
        return false
      }
      if (!following) {
        // Why: the reader is up in history; a data change now must not queue
        // a jump for whenever they return to the edge.
        pending = false
        return false
      }
      if (!pending) {
        return false
      }
      pending = false
      return true
    }
  }
}
