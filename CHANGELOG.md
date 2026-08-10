# Change Log

All notable changes to the "search-preview" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.0.0]

Search is roughly **36× faster**, and it no longer hides files from you.

### Fixed

- **Some files were silently missing from search results.** Exclude patterns were
  compiled without anchors, so `**/*.log` matched anywhere in a path — which meant
  a file called `app.logic.ts` or `app.log.txt` was quietly excluded. If you have
  ever searched for a file you were certain existed and got nothing, this may be why.
- **Exclusions were not applied while listing files.** The exclude list was joined
  with commas, which VS Code matches literally, so nothing was excluded and every
  search walked `node_modules`. Files were only filtered afterwards, in memory.
- Changing an exclude setting did nothing until the window was reloaded.
- A missing `fzf` binary left the picker spinning forever with no explanation.
  It now tells you what is wrong and where to get it.
- Rapid typing could leave stale results on screen, and abandoned `fzf` processes
  running behind them.
- Editor history was recorded twice per file switch, and one of the two listeners
  was never cleaned up.
- Previewing a file whose remembered line no longer exists (because the file got
  shorter) no longer fails silently.

### Performance

- The file list is now built once and cached across picker openings, rather than
  rebuilt on every keystroke. It refreshes automatically when files are added or
  removed, and ignores changes to paths you have excluded.
- The index is prepared in the background at startup, so the first search is as
  fast as the rest.
- Exclude patterns compile to direct string comparisons where possible — the
  matching step went from 1,276 ms to 7 ms across 50,000 files.
- Holding an arrow key no longer opens a document for every row it passes over.
- Search results appear sooner after each keystroke.
- Editor history is no longer written to disk on every single editor change.

### Changed

- Requires VS Code 1.108 or newer, for file icons drawn from your active icon theme.
- Exclude patterns now follow standard glob behaviour: a pattern without a slash
  (`*.log`) applies at any depth, and patterns match whole paths rather than
  fragments of them.

### Internal

- Glob matching moved into a standalone, dependency-free module with 25 tests
  covering it.
- Removed unused code and the unused `fuzzysort` dependency; enabled stricter
  TypeScript and lint settings to keep it that way.
- Diagnostics now go to a "Search Preview" output channel instead of the console.
