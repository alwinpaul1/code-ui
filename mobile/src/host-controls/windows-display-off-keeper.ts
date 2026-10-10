/**
 * Sleep display on a Windows PC with Modern Standby (S0 Low Power Idle), where the
 * display going off is otherwise the start of standby.
 *
 * Why it exists: on 2026-10-08 Sleep display put Danny's whole laptop to sleep and
 * the phone lost it. Microsoft documents that an AoAc system "will automatically
 * enter modern standby when the display goes off", and SC_MONITORPOWER is what
 * turns it off. The row was hidden there; on 2026-10-10 Danny asked for it back:
 * "keep the display off, not the Windows system off ... same like Mac", instantly,
 * with no timer.
 *
 * How: the sleep script (windows-host-commands.ts) starts this keeper as a hidden,
 * detached `powershell`. The keeper
 *   1. signals any keeper still running to stop (the wake event), and waits for it
 *      to let go of the single-instance mutex, so keepers never stack;
 *   2. holds a power request: PowerCreateRequest + PowerSetRequest
 *      (PowerRequestSystemRequired = 1; PowerRequestExecutionRequired = 3 as well,
 *      best effort, a refusal of it is not fatal);
 *   3. subscribes to GUID_CONSOLE_DISPLAY_STATE (the same callback subscription as
 *      the probe's WINDOWS_DISPLAY_NAMESPACE, windows-host-state.ts);
 *   4. sets the ready event the sleep script waits on, and only if that script is
 *      still waiting (it opens the event, which is gone once the script has given
 *      up and exited), then posts SC_MONITORPOWER(2) itself;
 *   5. waits for whichever comes first: the wake event (Wake display sets it before
 *      it turns the display on), the display reporting on after it reported off or
 *      dimmed (Wake display, or mouse or keyboard at the PC, as on the Mac), the
 *      display never reporting off within 20 s, or 12 hours;
 *   6. clears the request, unsubscribes and exits. Any failure before step 4 means
 *      nothing was turned off and the script refuses (keepawake).
 *
 * What is NOT known: whether a held SystemRequired request keeps the PC in S0 after
 * SC_MONITORPOWER at all. Microsoft documents requests being honoured when the
 * display goes off by idle timeout, and dropped on user-initiated sleep (lid close,
 * power button, Start > Sleep, which still sleep the PC as they should); a display
 * turned off by a program is neither. Danny's laptop is the experiment.
 *
 * On battery: PowerSetRequest's documentation says that on Modern Standby on DC,
 * system and execution requests are terminated five minutes after the system sleep
 * timeout expires. That timeout counts from the last system activity, so the wait
 * loop calls SetThreadExecutionState(ES_SYSTEM_REQUIRED) every 30 s, without
 * ES_CONTINUOUS: a one-shot reset of the system idle timer, which never lets the
 * sleep timeout expire, so the termination clock never starts. It leaves the display
 * idle timer alone (no ES_DISPLAY_REQUIRED), so the display stays off. It is not a
 * substitute for the request: on its own it reportedly does not keep S0 out of
 * standby with the display off (PowerToys #48965).
 *
 * Prior art: github.com/QXiaoLingShang/win-monitor-off holds the same
 * PowerRequestSystemRequired until input ends the blank.
 *
 * NOT YET RUN ON A WINDOWS MACHINE. PowerShell 7 on macOS parses the keeper and
 * compiles its type; named events, the power request and the display subscription
 * need Windows.
 */

/** Set by the keeper once it holds the PC awake; the sleep script creates it and waits. */
export const DISPLAY_OFF_READY_EVENT = 'Local\\CUIDisplayReady'
/** Set by Wake display (and by a new keeper) to end a running keeper at once. */
export const DISPLAY_WAKE_EVENT = 'Local\\CUIDisplayWake'
const KEEPER_MUTEX = 'Local\\CUIDisplayKeeper'
/** The longest the keeper holds the PC: 12 hours. */
export const HOLD_CAP_MS = 12 * 60 * 60 * 1000
/** A display that has not reported off by then is not held for 12 hours. */
export const OFF_WITHIN_MS = 20_000
/** How often the loop resets the system idle timer (the battery rule above). */
export const IDLE_RESET_EVERY_MS = 30_000

/**
 * The keeper's C# members, for Add-Type -MemberDefinition (which supplies the class,
 * CodeUI.Keeper, and the System and InteropServices usings; System.Threading comes
 * from -UsingNamespace). C# 5 for Windows PowerShell 5.1, free of single quotes: it
 * sits inside one, and the whole keeper again inside the sleep script's. Terse
 * because it rides inside the sleep command, base64 of UTF-16LE at about 2.7
 * characters a character, under cmd.exe's 8,191. R is REASON_CONTEXT with POWER_REQUEST_CONTEXT_SIMPLE_STRING (flag 1):
 * a version, flags, then the string pointer, which sequential layout puts at offset
 * 8 on both x86 and x64. A handle below 1 is a failed create (NULL or
 * INVALID_HANDLE_VALUE). The request handle is not closed: the process exits right
 * after clearing it, which closes it. C, P and O are the probe's display
 * subscription (windows-host-state.ts); o records that the display reported off or
 * dimmed, and e (auto-reset) wakes the loop on every report. 274 is WM_SYSCOMMAND.
 * The loop runs until i is 0, the wake event. Event names are C# verbatim strings, so
 * `\` needs no escape.
 */
export const WINDOWS_DISPLAY_OFF_KEEPER_MEMBERS = [
  'struct R{public int v,f;[MarshalAs(UnmanagedType.LPWStr)]public string s;}',
  'public delegate uint C(IntPtr c,uint t,IntPtr s);struct P{public C c;public IntPtr x;}',
  'const string K="kernel32",W="powrprof";',
  '[DllImport(K)]static extern IntPtr PowerCreateRequest(ref R r);',
  '[DllImport(K)]static extern bool PowerSetRequest(IntPtr h,int t);',
  '[DllImport(K)]static extern bool PowerClearRequest(IntPtr h,int t);',
  '[DllImport(K)]static extern int SetThreadExecutionState(int f);',
  '[DllImport("user32")]static extern bool PostMessage(IntPtr h,int m,IntPtr w,IntPtr l);',
  '[DllImport(W)]static extern uint PowerSettingRegisterNotification(ref Guid g,uint f,ref P p,out IntPtr h);',
  '[DllImport(W)]static extern uint PowerSettingUnregisterNotification(IntPtr h);',
  'static int v=-1;static bool o;static AutoResetEvent e=new AutoResetEvent(false);static C k;',
  'static uint O(IntPtr c,uint t,IntPtr s){if(s!=IntPtr.Zero){v=Marshal.ReadInt32(s,20);if(v!=1)o=true;e.Set();}return 0;}',
  'public static void Run(){',
  `var w=new EventWaitHandle(false,EventResetMode.ManualReset,@"${DISPLAY_WAKE_EVENT}");w.Set();`,
  `var m=new Mutex(false,@"${KEEPER_MUTEX}");`,
  'try{if(!m.WaitOne(5000))return;}catch(AbandonedMutexException){}',
  'try{w.Reset();',
  'R r=new R();r.f=1;r.s="Code UI display off";',
  'IntPtr q=PowerCreateRequest(ref r);if((long)q<1)return;',
  'try{if(!PowerSetRequest(q,1))return;PowerSetRequest(q,3);',
  'Guid g=new Guid("6FE69556-704A-47A0-8F24-C28D936FDA47");k=O;P p=new P();p.c=k;IntPtr h;',
  'if(PowerSettingRegisterNotification(ref g,2,ref p,out h)!=0)return;',
  'try{EventWaitHandle y;',
  `if(!EventWaitHandle.TryOpenExisting(@"${DISPLAY_OFF_READY_EVENT}",out y))return;`,
  'y.Set();y.Dispose();',
  'if(!PostMessage((IntPtr)0xFFFF,274,(IntPtr)0xF170,(IntPtr)2))return;',
  'var c=System.Diagnostics.Stopwatch.StartNew();',
  `for(int i=1;i!=0;){long t=(o?${HOLD_CAP_MS}:${OFF_WITHIN_MS})-c.ElapsedMilliseconds;if(t<1)break;`,
  'SetThreadExecutionState(1);',
  `i=WaitHandle.WaitAny(new WaitHandle[]{w,e},(int)Math.Min(t,${IDLE_RESET_EVERY_MS}));if(i==1&&o&&v==1)break;}`,
  '}finally{PowerSettingUnregisterNotification(h);}',
  '}finally{PowerClearRequest(q,1);PowerClearRequest(q,3);}',
  '}finally{m.ReleaseMutex();}}'
].join('')

/** The keeper as the hidden `powershell` runs it. Its `Run` blocks until the display
 *  comes back on (or a cap), so the process lives exactly as long as the hold. */
export const WINDOWS_DISPLAY_OFF_KEEPER_SCRIPT = `Add-Type -IgnoreWarnings -Namespace CodeUI -Name Keeper -UsingNamespace System.Threading -MemberDefinition '${WINDOWS_DISPLAY_OFF_KEEPER_MEMBERS}'\n[CodeUI.Keeper]::Run()`
