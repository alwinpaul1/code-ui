// Orders the answers home may draw. A read that started before a newer list was
// applied, or before a local change (removing a desktop from home itself), is
// older than what is on screen, and landing late must not put its list back:
// a stuck re-read passing the read cap, then landing after the user removed
// host b, would otherwise bring b back.
export function createHomeCatalogSequence() {
  let started = 0
  let floor = 0
  let applied = 0
  let drawnHostCount = 0
  let answered = false
  return {
    /** Call when a read starts; the number identifies it. */
    start(): number {
      started += 1
      return started
    },
    /** True (once) when read `n` is newer than everything applied and every local change. */
    accept(n: number, hostCount: number): boolean {
      if (n <= floor || n <= applied) {
        return false
      }
      applied = n
      answered = true
      drawnHostCount = hostCount
      return true
    },
    /**
     * True when a newer read or a local change already put a list on screen, so read `n` failing
     * says nothing about what is drawn and must not replace it with the failed-read body.
     */
    superseded(n: number): boolean {
      return n <= floor || n <= applied
    },
    /** A list this screen produced itself: every read already in flight is now older. */
    localChange(hostCount: number): void {
      floor = started
      answered = true
      drawnHostCount = hostCount
    },
    /** Whether any list has been applied yet, from a read or from this screen. */
    hasAnswer(): boolean {
      return answered
    },
    /** Whether a list with hosts is what the screen draws right now. */
    drawingHosts(): boolean {
      return drawnHostCount > 0
    }
  }
}
