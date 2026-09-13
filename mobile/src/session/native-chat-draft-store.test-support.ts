import AsyncStorage from '@react-native-async-storage/async-storage'
import { act } from 'react-test-renderer'

/**
 * Empties the chat draft and pending-echo stores between tests.
 *
 * Unmounting flushes the debounced writes it used to drop (see
 * use-debounced-persist), so without this one test's composer text or
 * optimistic bubble hydrates into the next test's mount. The microtask wait
 * matters: the flushed write is queued, and clearing before it lands leaves the
 * entry behind anyway.
 */
export async function clearNativeChatDraftStores(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  await AsyncStorage.clear()
}
