package com.termux.terminal;


/**
 * CODE UI: the client of a {@link TerminalEmulator}. Upstream's interface also carries the
 * callbacks of the PTY-bound TerminalSession, which this app does not vendor; those are gone.
 */
public interface TerminalSessionClient {







    void onTerminalCursorStateChange(boolean state);



    Integer getTerminalCursorStyle();



    void logError(String tag, String message);

    void logWarn(String tag, String message);

    void logInfo(String tag, String message);

    void logDebug(String tag, String message);

    void logVerbose(String tag, String message);

    void logStackTraceWithMessage(String tag, String message, Exception e);

    void logStackTrace(String tag, Exception e);

}
