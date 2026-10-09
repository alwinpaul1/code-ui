import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { agentTurnPlainText, agentTurnsByEnd } from './mobile-native-chat-turn-end'

/** What a row of the chat list is told about the turn it may end. */
export type MobileNativeChatTurnEndProps = {
  endsTurn: boolean
  turnHasProse: boolean | undefined
  turnStartIndex: number | undefined
  copyTurnText: (endId: string) => string
}

/**
 * The Claude app draws a reply's actions once, under the turn's last message,
 * and its Copy copies the whole reply; its arrow brings the reply's start to
 * the top. `rows` is the list's data in transcript order; the list itself is
 * inverted, so the start index it hands a row counts from the newest row.
 *
 * A row asks for its turn's words only when Copy is tapped, after a commit, so
 * a ref the commit updates is current then. Read through one stable callback,
 * the rows do not all re-render each time the transcript grows.
 */
export function useMobileNativeChatTurnEnds(
  rows: readonly NativeChatMessage[]
): (id: string) => MobileNativeChatTurnEndProps {
  const turnsByEnd = useMemo(() => agentTurnsByEnd(rows), [rows])
  const turnsByEndRef = useRef(turnsByEnd)
  useEffect(() => {
    turnsByEndRef.current = turnsByEnd
  }, [turnsByEnd])
  const copyTurnText = useCallback((endId: string): string => {
    const turn = turnsByEndRef.current.get(endId)
    return turn ? agentTurnPlainText(turn) : ''
  }, [])
  const rowCount = rows.length
  return useCallback(
    (id: string) => {
      const turn = turnsByEnd.get(id)
      return {
        endsTurn: turn !== undefined,
        turnHasProse: turn?.hasProse,
        turnStartIndex: turn ? rowCount - 1 - turn.firstIndex : undefined,
        copyTurnText
      }
    },
    [turnsByEnd, rowCount, copyTurnText]
  )
}
