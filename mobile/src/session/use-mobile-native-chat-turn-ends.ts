import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { agentTurnPlainText, agentTurnsByEnd, type AgentTurn } from './mobile-native-chat-turn-end'

/** What a row of the chat list is told about the turn it may end. */
export type MobileNativeChatTurnEndProps = {
  endsTurn: boolean
  turnHasProse: boolean | undefined
  copyTurnText: (endId: string) => string
  /** This row holds its turn's last words: while the work after them still
   *  runs, the turn's actions are drawn here, under the words and above the
   *  work, instead of at the turn's end. */
  anchorsTurnActions: boolean
  /** The turn's work after its last words (AgentTurn.trailingWork), told to
   *  the row with the words and to the row that ends the turn, so both read
   *  the same answer to "is it still running". */
  turnTrailingWork: readonly NativeChatBlock[] | undefined
  /** Whether this row's turn is the newest thing in the list, so the agent's
   *  working state is about it. */
  turnIsNewest: boolean | undefined
}

const NO_PENDING: readonly { id: string }[] = []

/**
 * `pending` are the phone's echoes of messages it sent, drawn as rows before
 * the transcript takes them: they do not make the turn before them old.
 *
 * The Claude app draws a reply's actions once per turn, and its Copy copies
 * the whole reply. They sit under the turn's last words while work after them
 * still runs, and under the turn's last message once it is over
 * (mobile-native-chat-turn-end.ts). `rows` is the list's data in transcript
 * order.
 *
 * A row asks for its turn's words only when Copy is tapped, after a commit, so
 * a ref the commit updates is current then. Read through one stable callback,
 * the rows do not all re-render each time the transcript grows.
 */
export function useMobileNativeChatTurnEnds(
  rows: readonly NativeChatMessage[],
  pending: readonly { id: string }[] = NO_PENDING
): (id: string) => MobileNativeChatTurnEndProps {
  // A message sent mid-turn draws its echo after the running turn, which is
  // still the turn the agent is working on.
  const echoIds = useMemo(() => new Set(pending.map((item) => item.id)), [pending])
  const turnsByEnd = useMemo(() => agentTurnsByEnd(rows, echoIds), [rows, echoIds])
  // The same turns under the id of the row holding each one's last words.
  const turnsByWords = useMemo(() => {
    const byWords = new Map<string, AgentTurn>()
    for (const turn of turnsByEnd.values()) {
      if (turn.proseEndId !== undefined) {
        byWords.set(turn.proseEndId, turn)
      }
    }
    return byWords
  }, [turnsByEnd])
  const turnsRef = useRef({ turnsByEnd, turnsByWords })
  useEffect(() => {
    turnsRef.current = { turnsByEnd, turnsByWords }
  }, [turnsByEnd, turnsByWords])
  // Asked with the id of whichever row draws the actions: the turn's end, or
  // the row with its last words while the work after them runs.
  const copyTurnText = useCallback((id: string): string => {
    const turn = turnsRef.current.turnsByEnd.get(id) ?? turnsRef.current.turnsByWords.get(id)
    return turn ? agentTurnPlainText(turn) : ''
  }, [])
  return useCallback(
    (id: string) => {
      const ended = turnsByEnd.get(id)
      const worded = turnsByWords.get(id)
      const turn = ended ?? worded
      return {
        endsTurn: ended !== undefined,
        turnHasProse: turn?.hasProse,
        copyTurnText,
        anchorsTurnActions: worded !== undefined,
        turnTrailingWork: turn?.trailingWork,
        turnIsNewest: turn?.isNewest
      }
    },
    [turnsByEnd, turnsByWords, copyTurnText]
  )
}
