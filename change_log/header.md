# change_log — Read This First

> ⚠️ MANDATORY: Before reading or writing ANY file in `change_log/`, read this
> file completely. It defines how every change entry must be recorded. If this
> file and any external guidance disagree, this file wins.

## Purpose

`change_log/` is the chronological record of every change made to the project.
Each entry explains why a change happened and what resulted, so the project's
history is auditable without re-reading diffs.

## One File Per Conversation

- Every distinct conversation / work session produces exactly ONE new file.
- Never append a new session's changes to a previous session's file.
- Within a single session's file you may record multiple related changes.

## Append-Only History (Never Edit Past Records)

The change log is an immutable audit trail. Never overwrite, edit, or delete an
existing change-log file or a previously written entry.

- Files from previous conversations are frozen; do not touch them.
- Within the current session's file, only ADD entries; do not rewrite earlier
  ones.
- If a past record turns out to be wrong or incomplete, do NOT modify it.
  Instead add a NEW entry (a new file for a new conversation) that references
  the original by filename and states the correction.
- `scripts/new_change.py` refuses to overwrite an existing file, so history is
  protected by default.

## File Naming

    change_log_<YYYY>_<MM>_<DD>_<HH>_<MM>_<SS>_<title>.md

- The timestamp MUST be the real system time (obtain it from the OS), never a
  guessed or model-invented value.
- `<title>` is a short lowercase snake_case summary of the session.
- Example: `change_log_2026_07_31_14_09_05_add_auth_module.md`

## Required Sections (every entry)

Each change entry MUST contain these four sections, in this order:

1. **Problem / Requirement** — what was asked, or what was wrong.
2. **Purpose of Change** — the goal the change is meant to achieve.
3. **How It Was Changed** — the concrete actions, files, and approach. For
   EVERY modified file, list the approximate changed line range as a clickable
   link that jumps to that range in the editor (see "Linking to Changed Code").
4. **Result** — the outcome, verification, and any follow-ups.

## Linking to Changed Code

In section 3, reference each modified file with a clickable link that jumps to
the changed line range. Generate it automatically so the link matches whatever
editor is in use:

    python <skill>/scripts/make_link.py <file> <start> <end>

`make_link.py` auto-detects the editor and emits a precise deep link for
VS Code / Cursor / Windsurf (e.g. `vscode://file/<abs>:<line>`), and otherwise
falls back to a universal link that still opens the file everywhere:

    [<relative/path.ext> L<start>-L<end>](file:///<ABSOLUTE/path.ext>#L<start>-L<end>)

- Deep links jump to the exact line; the fallback opens the file and jumps in
  most Markdown previews.
- The link TARGET must use the file's ABSOLUTE path so editors can resolve it.
- The line range is approximate (the span the change touches), not an exact diff.

## Entry Template

    # <Title>

    - Date: <YYYY-MM-DD HH:MM:SS>
    - Session: <one-line context>

    ## Problem / Requirement
    ...

    ## Purpose of Change
    ...

    ## How It Was Changed
    - [<relative/path.ext> L<start>-L<end>](file:///<ABSOLUTE/path.ext>#L<start>-L<end>) — <what changed here>
    - ...

    ## Result
    ...
