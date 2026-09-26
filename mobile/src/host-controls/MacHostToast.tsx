import { FloatingToast } from '../ui/FloatingToast'

/** The one line of feedback a Mac control gets. Never carries the command — the
 *  unlock one holds the user's password. */
export function MacHostToast({ message }: { message: string | null }) {
  return <FloatingToast message={message} />
}
