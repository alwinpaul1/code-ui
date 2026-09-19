// The injected-timer seam's real contract: `typeof setTimeout` additionally demands
// Node's `__promisify__` member, which no injected timer (or safe wrapper) can supply.
export type ScheduleTimer = (handler: () => void, ms: number) => ReturnType<typeof setTimeout>

// Why: browsers throw Illegal invocation when a global timer is called with a non-global receiver; Hermes does not.
export const defaultScheduleTimer: ScheduleTimer = (handler, ms) => setTimeout(handler, ms)
// CODE UI: under the @types/node 22 this fork resolves beside the React Native lib, the contextual
// parameter is the union of every clearTimeout overload and no single overload takes `null`, so
// the null arm is answered here; clearing nothing is what the global does with it anyway.
export const defaultCancelTimer: typeof clearTimeout = (handle) => {
  if (handle == null) {
    return
  }
  clearTimeout(handle)
}
