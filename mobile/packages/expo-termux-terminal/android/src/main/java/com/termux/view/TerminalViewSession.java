package com.termux.view;

import com.termux.terminal.TerminalEmulator;

/**
 * CODE UI: what {@link TerminalView} needs from a session. Upstream binds the view to the concrete
 * {@code com.termux.terminal.TerminalSession}, which is final and owns a local PTY subprocess. This
 * app has no local process — the bytes come from the desktop over the relay — so the view takes
 * this interface instead, and {@code RemoteTerminalSession} implements it over that channel.
 */
public interface TerminalViewSession {
    TerminalEmulator getEmulator();

    void updateSize(int columns, int rows, int cellWidthPixels, int cellHeightPixels);

    /** Text typed or pasted, to the process. */
    void write(String data);

    void writeCodePoint(boolean prependEscape, int codePoint);

    void onCopyTextToClipboard(String text);

    void onPasteTextFromClipboard();
}
