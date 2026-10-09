# Kurone-ko Timer — Development Journal

## From idea to v1.1.0

---

## Conception

Kurone-ko Timer started as a simple idea: a **minimalist floating Pomodoro widget** for Windows. No bloated task manager, no login screens, no productivity suite. Just a timer that floats on top of your work, stays out of the way, and lets you focus. The name comes from 黒猫 (kuroneko — "black cat" in Japanese), a symbol of quiet company during deep work.

The vision was clear from day one: **warm, focused, cat-themed, distraction-free**.

### Quick glossary

| Term | What it means |
|------|---------------|
| **State machine** | A system that can only be in one state at a time (idle → running → paused → session-complete). Prevents impossible situations like "pausing an already-paused timer." |
| **MVP** | Minimum Viable Product — the smallest version that actually works. No extra features. |
| **Drift** | When a timer slowly loses accuracy. A 25-minute countdown that actually takes 25 minutes and 8 seconds has "drifted" by 8 seconds. |
| **Physical vs Logical pixels** | On a 4K screen at 150% scaling, a 100px "logical" element actually uses 150 "physical" dots. Mixing them up causes windows to appear in wrong positions. |
| **IPC** | Inter-Process Communication — how the JavaScript frontend talks to the Rust backend. Tauri translates JS calls into Rust commands. |
| **ACL** | Access Control List — Tauri 2's permission system. Every JS API call (close a window, move a window, play audio) must be explicitly allowed. Like a bouncer at a club: no name on the list, no entry. |
| **ACL permissions** | Specific entries in the "bouncer's list" — e.g., `allow-set-position` lets JS move windows. Without it, the call is silently rejected. |
| **Catch block** | The `catch {}` part of `try { ... } catch { ... }`. An empty one means "if this fails, I don't want to know." Dangerous during development. |
| **CLI** | Command-Line Interface — tools you run from the terminal (like `npm`, `tauri`, `cargo`). |
| **JSON** | A simple text format for storing data. The app saves timer state, history, and settings as `.json` files. |
| **E2E** | End-to-End testing — simulating a real user clicking buttons in the actual app, checking everything works together. |
| **Webview** | The browser engine inside Tauri that renders the HTML/CSS/JS. It's like a mini Chrome without the address bar. |
| **CDP** | Chrome DevTools Protocol — how Playwright connects to Tauri's internal webview to run automated tests. |
| **State store** | A central object that holds the app's current data (timer status, settings, history). Any component can read from it; changes trigger re-renders. |
| **DI** | Dependency Injection — passing services (like audio playback or file storage) into a store as parameters, rather than hardcoding them. Makes testing easy: inject a fake audio service that doesn't make sound. |
| **Mount/unmount** | When a React component appears on screen, it "mounts". When it disappears, it "unmounts". `useEffect` runs code on mount (start tracking position) and cleanup on unmount (stop tracking). |
| **Debounce** | Ignoring rapid-fire events and only acting after a pause. The window-drag clamping uses an 80ms debounce: don't snap the window back on every pixel of movement, only after the user stops dragging. |
| **Tauri command** | A Rust function exposed to JavaScript via `#[tauri::command]`. JS calls `invoke("save_history", { ... })` and Rust handles the file I/O. |

---

## v1.0.0 — The MVP

### Core features

- Focus/break timer with Pomodoro state machine
- Floating widget (300×150, always-on-top, transparent, borderless)
- Dashboard window (360×640) for configuration
- Session history with daily summaries
- Music playback (built-in Kurone-ko Playlist — `.ogg` files)
- Settings persistence (JSON files via Tauri fs)
- E2E Playwright smoke tests

### First technical challenge: State machine with drift-safe timing

**Problem**: Using `setInterval` (JavaScript's "repeat every second" timer) caused drift — the countdown would lose seconds over time. By the end of a 25-minute session, it could be 5-10 seconds off.

**Solution**: Absolute-time targets. Instead of counting down "tick by tick", the timer remembers the exact moment it should end: `targetEndTime = Date.now() + durationSeconds * 1000`. On each check, it recalculates `remaining = targetEndTime - Date.now()`. This guarantees accuracy regardless of how long each interval actually took.

```typescript
// Drift-safe: remaining = targetEndTime - Date.now()
// Not: remaining = remaining - 1 (drifts)
```

### Second challenge: Window switching

**Problem**: Dashboard and timer are separate Tauri windows. Switching between them requires position synchronization — if the user drags the timer to the right side of the screen, the dashboard should appear near it, not at the default top-left.

**Solution evolution** (multiple iterations):

1. **First attempt**: `setPosition()` before `show()`. Failed — Windows' window manager ignores `SetWindowPos` for never-shown windows (`CW_USEDEFAULT` semantics).
2. **Second attempt**: `show()` before `setPosition()`. Stopped working after a seemingly unrelated code change. Root cause: **missing ACL permissions** — the bouncer wasn't letting the "move window" request through. Tauri 2 silently rejects any JS call that doesn't have an explicit allow-entry in its permissions file. The empty catch blocks meant we never saw the rejection.
3. **Third attempt**: Added `position_window` Rust command as a backup. Redundant once permissions were fixed.
4. **Final solution**: `hide current → setPosition → show target`. Eliminates flicker. Screen boundary clamping via `currentMonitor()`.

**Key lesson**: Tauri 2's ACL system is strict. Every JS API call that modifies state requires an explicit permission in `capabilities/default.json`. Silent failures are debugging hell.

---

## v1.1.0 — Identity & UX Polish

### Branding iterations

The app shipped with default Tauri placeholder icons — a blue/green generic shape. To give Kurone-ko its visual identity:

1. **Mascot design**: A black cat (kuroneko) with a pink cap and "K" — the cap is the key branding element because it remains recognizable at 16×16 (taskbar size), while a full cat illustration becomes a blurry blob.
2. **Icon generation**: All formats (`.ico`, `.icns`, 16 PNG sizes, Android, iOS) generated from a single 1024×1024 master PNG via `tauri icon` CLI. No manual export — the tool guarantees correct dimensions and names.
3. **Text branding removed**: The dashboard originally had "KURONE-KO" eyebrow + "Prepare. Focus. Return." headline. With the mascot now occupying the hero position, this text became redundant. The mascot IS the brand. Removing it freed vertical space for a larger illustration.
4. **Footer identity**: "Focus setup lives here. The widget stays distraction-free." was generic filler. Replaced with "Developed by DevMPoveaCL" — a professional authorship credit, standard in desktop software, styled subtle and low-opacity.

### Typography: from Inter to Nunio, with a detour through Japan

The app started with `Inter, system-ui` — the most generic font stack in existence. Corporate, cold, clinical. No personality for a cat-themed Japanese Pomodoro app.

**First attempt — M PLUS Rounded 1c**: A Japanese rounded font, warm and distinctive. Perfect in theory. Failed on Windows because the font's Latin glyphs lack proper ClearType hinting — the text rendering engine that Windows uses to make fonts crisp on LCD screens. At UI sizes (9-14pt), the letters looked pixelated and uncomfortable to read.

**Final choice — Nunito**: Rounded, warm, excellent Windows rendering at all weights (400-900). Google Fonts served via `@import`. The `ui-rounded` fallback in the font stack ensures the browser picks the next best rounded system font if Nunito fails to load.

### Layout radicalism

The dashboard layout went through 3 iterations:

1. **v1**: Text branding + small mascot (200×160) + 3 buttons + summary box
2. **v2**: Removed text branding, mascot enlarged to 260px, transparent window margins eliminated (shell padding 0, card border-radius 0)
3. **v3**: Compacted spacing (card padding 10px, mascot margin 12px), focus summary de-boxed (removed border/background that made it look like a clickable button), developer signature added

### Scrollbar DRY — a CSS architecture lesson

Identical scrollbar CSS (colors, widths, webkit pseudo-elements) was copied 3 times across `App.css` and `Dashboard.css` for `.config-shell`, `.history-panel`, `.timer-duration-list`, and `.timer-duration-dropdown`.

**Failed attempt**: Created a `.kuroneko-scroll` utility class and applied it to JSX elements. Broke scrollbar styling because not all scrollable elements received the class.

**Working solution**: CSS selector grouping within each file. No JSX changes needed. Each CSS file groups its scrollable selectors:

```css
/* App.css */
.history-panel,
.timer-duration-list,
.timer-duration-dropdown {
  scrollbar-color: rgba(231, 160, 184, 0.46) rgba(255, 255, 255, 0.06);
  scrollbar-width: thin;
}
/* Dashboard.css */
.config-shell,
.onboarding-modal {
  scrollbar-color: ...;
  scrollbar-width: thin;
}
```

### Keyboard shortcuts: 3 guardrails, 4 iterations

The `useKeyboardShortcuts` hook went through 4 versions to handle conflicts:

| Version | Guardrails | Problem found |
|---------|-----------|---------------|
| v1 | Input guard only | Space on focused button → timer shortcut fired instead of button activation |
| v2 | Added button guard (block all keys on focused button) | After Tab-navigating, M, H, R stopped working |
| v3 | Button guard only blocks Space | User feedback: Space should ALWAYS be timer action, not button activation |
| v4 | Removed button guard. Added modal guard (blocks non-Escape, non-Ctrl keys when dialog open) | Prevents "S" from opening Settings behind the shortcuts modal |

The modal guard has one exception: Ctrl+Arrows always pass through, so you can move the window even while reading the shortcuts reference.

### Window position sync — 4 iterations, 1 root cause

The full saga is documented in the v1.0.0 section above. The TL;DR:

1. `setPosition` before `show` → Windows ignores it
2. `show` before `setPosition` → ACL permissions missing
3. Rust command backup → redundant
4. Final: `hide current → setPosition → show target` + `clampToMonitor()` + 80ms debounce on drag + `onMoved` minimize guard (Windows sends garbage coordinates on minimize)

### Cross-window reactivity

**Problem**: Dashboard summary showed 0 sessions even though a focus session just completed in the timer. Both windows were open simultaneously, but the dashboard had no way to know the timer's state had changed.

**Solution**: Tauri's event system. The history store emits `history-updated` after saving a session. The dashboard listens via `listen("history-updated")` and re-hydrates the summary. Both imports use dynamic `import()` so the test environment (which lacks Tauri's IPC layer) doesn't crash.

### Screen boundary clamping

**Problem**: The dashboard is 640px tall. If the timer is at the bottom of a 1080p screen and the user clicks "Return to dashboard", the centered dashboard would extend 320px below the screen edge.

**Solution**: `clampToMonitor()` queries `currentMonitor()` at runtime and constrains the calculated position so the full window stays visible. Applied in two places: when switching windows AND when dragging (via `onMoved` handler). The drag handler uses an 80ms debounce to avoid rapid snap-back flicker while the user is actively dragging against an edge.

### Historical exit implementation: destroy (superseded)

The original dashboard Exit button used `window.destroy()` to avoid a cancelable close event, with frontend cleanup in `onCloseRequested`. This recommendation is historical and superseded: native close requests are now owned by Rust/Tauri, which exits the application when either app window closes. Dashboard Exit routes through native close; native lifecycle handling is the shutdown authority.

### Layout polish: `inert` cascade

When modals (onboarding, shortcuts) are open, Tab navigation should be trapped within the modal. The `inert` HTML attribute makes an element and its descendants non-interactive and non-focusable.

**Bug**: Applied `inert` to the dashboard shell — but modals are children of the shell, so they became inert too. The entire app froze.

**Fix**: Apply `inert` only to the `<section class="dashboard-card">` — the content area. Modals are siblings, not children, so they remain interactive.

## Technical Lessons

### Tauri 2 ACL — check permissions first

Every `setPosition`, `close`, `destroy` call was silently failing. The JS API throws a rejected Promise, but empty catch blocks swallowed all errors. Two missing lines in `capabilities/default.json` cost hours:

```json
"core:window:allow-set-position",
"core:window:allow-close",
"core:window:allow-destroy"
```

**Rule**: When a Tauri API call doesn't work despite correct logic, check `capabilities/default.json` first. Always log errors in catch blocks during development.

### Physical vs Logical pixels

The window position API returns coordinates in "screen dots" (physical), but the window dimensions in config are "design pixels" (logical). On a 4K screen at 150% scaling, the math `centerX = pos.x + 360/2` uses physical X with logical width — producing wrong results. Fix: derive a scale factor from the current window (`physicalWidth ÷ logicalWidth`) and apply it to all dimensions.

### NSIS installer customization — deferred

MUI2 has `MUI_BGCOLOR`/`MUI_TEXTCOLOR` for dark themes, but system controls (buttons, scrollbars) remain Windows-default. Full customization requires complete nsDialogs pages with custom bitmap backgrounds. Image specs defined (8 BMPs), pending Photoshop assets. In roadmap backlog.

### The `inert` cascade

Applied `inert` to dashboard shell to block Tab focus on background during modals. Result: entire app frozen — modals are children of the shell, so they inherited `inert`. Fix: apply to the card, not the shell.

### React vs Tauri events

The browser's `window.addEventListener("focus")` doesn't fire reliably inside Tauri's webview. When the OS gives focus to a Tauri window, the webview inside it may not get the memo. Use `getCurrentWindow().onFocusChanged()` — a Tauri-specific event that always fires when the native window receives or loses focus.

### Shutdown Lingering Process (historical report and current implementation)

**Reported problem**: Pressing Alt+F4 or natively closing the visible window was reported to leave the app process and background music running because the hidden sibling window could keep the Tauri process alive. Current debug testing has not reproduced a production shutdown failure; no production lifecycle bug was changed as part of the release reconciliation.

**Current implementation**: Rust/Tauri is the authoritative shutdown owner. `on_window_event` handles `WindowEvent::CloseRequested` and exits the app when either app window closes. Dashboard Exit routes through the native close path. Focused Windows E2E checks passed for dashboard Exit and native Dashboard/Timer close with real playlist playback active.

**Verification evidence and limits**: Debug checks passed for dashboard Exit and native Dashboard/Timer close with actual audio. The generated `target/release/kurone-ko.exe` was runtime-tested without the DEV E2E driver using real user settings/history and explicit consent; native Timer close stopped the app and its tracked WebView descendants while music was active. Release Dashboard `WM_CLOSE` also stopped the app and its children, but music evidence for that path was UI-only, not actual Audio playback evidence.

The installed `KURONE-KO/kurone-ko.exe` version 1.1.1 was then smoke-tested. Native Dashboard close had actual Audio playing (`paused=false`, `readyState=4`), with `currentTime` advancing from `0.098` to `1.115`; native Timer close likewise had actual Audio playing and advancing from `0` to `0.836`. In both cases, the app and its tracked WebView descendants exited. Final inspection found zero installed-app processes and no listener on port 9334. Settings/history SHA256 matched the verified backup. This check exercised native close (`WM_CLOSE`), not the dashboard UI Exit action or keyboard Alt+F4. The intermittent 1.1.0 report was not reproduced, and its cause remains unproven; no new production shutdown code was added for this verification. The `1.1.1` development target remains unpublished.

### Tauri Cargo Cache & Stale Paths

During E2E testing, Tauri refused to launch due to a missing permissions file: `app_hide.toml (os error 3)`. The build was looking at an old absolute path (`E:\...\Kurone-ko\...`) instead of the current workspace (`kurone-ko-timer`). 
**Fix**: `cargo clean` inside `src-tauri` forced regeneration of the permissions path mappings. Always clean cargo cache after renaming or moving a Tauri 2 workspace.

---

*Developed by DevMPoveaCL · Kurone-ko Timer · 2026*
