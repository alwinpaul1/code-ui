@echo off
rem Code UI status line for Claude Code on Windows (cmd). Runs the PowerShell
rem version next to this file; PowerShell ships with every Windows.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0code-ui-statusline.ps1"
