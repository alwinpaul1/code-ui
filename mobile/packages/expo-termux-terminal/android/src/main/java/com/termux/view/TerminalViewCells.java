package com.termux.view;

import com.termux.terminal.TerminalBuffer;
import com.termux.terminal.TerminalEmulator;
import com.termux.terminal.TerminalRow;

/**
 * CODE UI: the renderer's cell metrics are package-private, and the host that maps a tap to a
 * cell and reads that cell's row lives in another package. This is the only way in; it adds no
 * behaviour. {@link TerminalView#getCursorY(float)} is not used because it carries the 40 px
 * finger offset the selection handles want.
 */
public final class TerminalViewCells {

    private TerminalViewCells() {}

    /** The column under an x pixel, clamped to the grid. */
    public static int columnAt(TerminalView view, float x) {
        TerminalEmulator emulator = view.mEmulator;
        if (emulator == null || view.mRenderer == null) return 0;
        int column = (int) (x / view.mRenderer.mFontWidth);
        return Math.max(0, Math.min(emulator.mColumns - 1, column));
    }

    /** The screen row under a y pixel (negative rows are scrollback), clamped to the grid. */
    public static int rowAt(TerminalView view, float y) {
        TerminalEmulator emulator = view.mEmulator;
        if (emulator == null || view.mRenderer == null) return 0;
        int row = (int) (y / view.mRenderer.mFontLineSpacing) + view.getTopRow();
        int transcriptRows = emulator.getScreen().getActiveTranscriptRows();
        return Math.max(-transcriptRows, Math.min(emulator.mRows - 1, row));
    }

    /** One row's text, trailing blanks trimmed, without joining wrapped neighbours. */
    public static String rowText(TerminalEmulator emulator, int row) {
        return emulator.getScreen().getSelectedText(0, row, emulator.mColumns - 1, row, false, false);
    }

    /** The last screen row that holds a printing character, or -1 when the screen is blank. */
    public static int lastPrintingRow(TerminalEmulator emulator) {
        TerminalBuffer screen = emulator.getScreen();
        for (int row = emulator.mRows - 1; row >= 0; row--) {
            TerminalRow line = screen.allocateFullLineIfNecessary(screen.externalToInternalRow(row));
            char[] text = line.mText;
            int used = line.getSpaceUsed();
            for (int i = 0; i < used; i++) {
                if (text[i] != ' ') return row;
            }
        }
        return -1;
    }
}
