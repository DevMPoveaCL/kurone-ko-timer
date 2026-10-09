# Kurone-ko Timer — Next Version Roadmap

This document tracks the published baseline, the current unreleased development target, and proposed future improvements.

## Current Baseline

- Latest published/local release tag: `v1.1.0` — identity, UX polish, keyboard shortcuts, and window position sync.
- Current development target: `v1.1.1` (unreleased). All application manifests identify this target; no release tag or publication is implied.
- Windows installers are available for the published release as `.msi` and `.exe` assets.
- CI runs the Vitest suite (177 tests) and TypeScript checks. Playwright E2E is not configured in CI.
- The manual Windows release workflow builds installers and can attach them to an existing release.

## v1.1.0 — Identity and UX Polish ✅

Goal: make the app feel more intentional, branded, and polished without changing the core timer behavior.

### App identity ✅

- Kurone-ko mascot (black cat + pink cap/K) as dashboard hero.
- All icons branded via `tauri icon` CLI from master PNG.
- Icon visible in taskbar, Start Menu, window, and installer metadata.

### UI polish ✅

- "Start Session" button centered, renamed from "Start Focus".
- Typography: Inter → Nunito (warm, rounded, crisp on Windows). M PLUS Rounded 1c rejected (poor Latin hinting).
- Dashboard layout: mascot hero (no text branding), compact spacing, full-bleed window.
- Focus summary redesigned (removed box that looked like a button).
- Footer: "Developed by DevMPoveaCL".
- Settings renamed from "Configuration". "Methods" → "Zettelkasten".
- Unified scrollbar CSS (DRY): grouped selectors, no JSX changes.
- Keyboard focus indicators (`:focus-visible` with rose outline).
- Exit button (✕) with proper music cleanup via `onCloseRequested`.

### Keyboard shortcuts ✅

- Timer: `S` (start/pause/resume), `R` (reset), `M` (music), `H` (history), `Escape` (dashboard).
- Dashboard: `S` (settings), `I` (instructions), `H` (shortcuts reference), `Escape` (back).
- Global: `Ctrl+Arrows` (move window), `Escape` (close panels).
- Shortcuts reference panel (`?` button → `H` key).
- Three guardrails: input blocking, modal blocking, Ctrl bypass.
- Auto-focus on startup (no click needed).

### Window position sync ✅

- Windows remember positions across switches (localStorage).
- Centered on each other when switching (hide → position → show, no flicker).
- Clamped to monitor bounds (can't drag off-screen, 80ms debounce).
- `currentMonitor()` for multi-resolution support (tested 1366×768 through 4K).
- ACL permissions fixed (`allow-set-position`, `allow-close`, `allow-destroy`).
- Rust `position_window` command as positioning backend.

### Onboarding & instructions ✅

- Updated text reflecting built-in playlist and upcoming features.
- "Start focusing" → "Got it" + X close button.
- Escape and arrow keys work in modals.

### Cross-window reactivity ✅

- Dashboard refreshes history when timer completes a session (Tauri event `history-updated`).
- `onFocusChanged` for reliable focus detection (replaced unreliable `window.focus`).

### Release validation ✅

- Builds: NSIS `.exe` and WiX `.msi` with branded icons.
- Smoke tested via `npm run tauri dev`.

## v1.1.1 — Shutdown Reliability (unreleased development target)

Goal: ensure the application terminates completely without leaving lingering processes. The existing native shutdown hook passed debug, generated-release, and installed 1.1.1 verification; the intermittent 1.1.0 report's cause remains unproven.

- **Native close authority**: Rust/Tauri handles close requests for either the Dashboard or Timer and exits the app, including music cleanup.
- **Dashboard Exit**: the UI Exit action routes through native close logic.
- **Verified debug behavior**: dashboard Exit and native Dashboard/Timer close passed all three focused Windows E2E paths with actual audio playback.
- **Generated release target**: `target/release/kurone-ko.exe` was runtime-tested without the DEV E2E driver using real user settings/history and explicit consent. Native Timer close had actual playlist audio playing; the app and its tracked WebView descendants exited. Release dashboard `WM_CLOSE` also stopped the app and its children, but music evidence for that path was UI-only, not native Audio playback evidence.
- **Installed 1.1.1 smoke**: Dashboard and Timer native close were tested on the installed app, each with actual audio (`paused=false`, `readyState=4`); playback advanced from `0.098` to `1.115` on Dashboard and from `0` to `0.836` on Timer. The app and tracked WebView descendants exited; the final check found no installed-app processes and no listener on port 9334. Settings/history SHA256 matched the verified backup. UI Exit and keyboard Alt+F4 were not tested in this installed check.
- **Report and scope**: the intermittent 1.1.0 behavior was not reproduced, and its cause is not proven. No new production shutdown code was added as part of this verification; installed 1.1.1 smoke evidence does not establish the cause of the earlier report.
- **E2E coverage**: shutdown harness and focused harness tests exist. The focused harness tests are separate from the normal Vitest suite; Playwright E2E is not part of CI.

## v1.2.0 — Spotify Playlist Integration

Goal: allow users to connect focus sessions with music while avoiding heavy bundled audio assets.

### Discovery first

- Investigate Spotify Web API requirements.
- Decide whether Kurone-ko needs full authentication or can start with curated external playlist links.
- Compare tradeoffs:
  - curated public Kurone-ko playlist links: simpler, lighter, less control
  - user Spotify integration: richer, requires OAuth and token handling

### Possible features

- Open a curated Kurone-ko focus playlist.
- Let users configure their own playlist URL.
- Later: Spotify OAuth to read/play user playlists if product value justifies the complexity.

### Risks

- Spotify API authentication increases implementation and security complexity.
- Playback control may require Spotify Premium depending on API usage.
- External service dependency means some features may not work offline.

## v1.3.0 — Additional Personalization

Custom focus/break durations, session goals, and preferences persistence are already implemented. Potential future personalization beyond those existing features:

- Optional session labels.
- Optional sound/theme settings.
- Maintain simple defaults so the app still works immediately.

## Backlog

- Improve release notes template.
- Add screenshots of the installed Windows app.
- Consider signing Windows installers in the future.
- E2E harness coverage exists, including shutdown scenarios; improve it as needed. Playwright E2E is not currently run by CI.
- Audit final installer size if it grows beyond roughly 100–200 MB.

## Principles for Future Work

- Do not add complexity before the user value is clear.
- Prefer small PRs with one clear purpose.
- Keep `main` protected and release builds reproducible.
- Do not commit generated installers or build artifacts to the repository.
- Validate releases with both automated checks and manual smoke tests.
