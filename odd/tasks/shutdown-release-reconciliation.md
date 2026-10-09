# ODD: Shutdown and Release Reconciliation

## Objective
Audit intermittent Windows shutdown with real playlist audio; reconcile roadmap and versions without speculative lifecycle changes. Preserve user settings/history and two-window architecture.

## Scope and configuration
- Branch: `fix/shutdown-release-reconciliation`; base `7bd0e5b`.
- Strict TDD: persisted project capability Engram #625; Vitest, Cargo and Playwright.
- Delivery: ask-on-risk, user selected stacked-to-main; user accepted size exception for the coherent observer/harness unit. Actual first unit: 893 additions / 54 deletions including adapters and tests.
- User authorized local commits, installer replacement, backup and smoke with real data. No push, PR creation, tag or publication authorized.
- Preserve pre-existing `.codegraph/`.

## Tasks
### SHUT-1 — Trustworthy shutdown evidence
Status: complete; committed `3433fb5`; independent post-commit checks passed.
Route: delegated workers/verifiers; multi-file and execution triggers.
- [x] Track actual app identity and scoped WebView ancestry, not only launcher/CDP.
- [x] Real playlist playback and native-close helper with PID/path/creation/HWND guards.
- [x] Fixture metadata outside cleaned results; guarded cleanup; isolated CDP.
- [x] Debug dashboard Exit and native dashboard/timer regression pass.
- [x] Focused harness tests 21/21, frontend 177, TypeScript clean.
- [x] Complete independent post-commit validation: Vitest177, focused harness21, TypeScript, Playwright2 including all three shutdown stages; no fixture survivors.
Native review assessment unavailable; START rejected `candidate-target-projection-drift` before lineage creation, no mutation. No native approval exists. Independent risk-gated verification is used; native authority remains untouched.

### SHUT-2 — Release and installed verification
Status: verified; production lifecycle unchanged.
Route: delegated investigation/build/installed smoke.
- [x] Generated release 1.1.1 and verified real Audio/time progress before timer native close; app and 8 WebView descendants exited.
- [x] Built unsigned NSIS 1.1.1; generated template verified, stale checked-in template not used.
- [x] Backup both app-data roots, file-by-file SHA256 verification (3 Roaming files, 604 Local files).
- [x] User completed interactive upgrade preserving data; installed executable and registry 1.1.1.
- [x] Installed native dashboard and timer close with actual Audio paused false/readyState 4/time advancing; all tracked processes exited.
- [x] Final installed app process count 0; test port 9334 listeners 0.
- [x] Settings/history unchanged; snapshot differs ONLY `savedAt`, independently inspected after final smoke.
Limits: old installed 1.1.0 intermittent defect not reproduced; no new production fix is claimed. Installed physical Alt+F4 and installed UI Exit not directly exercised. Debug UI Exit passed with actual audio.

### REL-1 — Versions and project documentation
Status: complete; committed `2eecc5d`; independent checks passed (Vitest177, Cargo5, TypeScript, manifest readback, committed diff check).
Route: delegated writer.
- [x] All package/Tauri/Cargo manifest and app-lock versions 1.1.1.
- [x] Roadmap reconciled completed preferences/durations and existing E2E; CI limits accurate.
- [x] Journal's historical destroy recommendation superseded.
- [x] README/roadmap/journal reflect installed and release evidence and limits; 1.1.1 remains unpublished.
Checks: manifest readback, Vitest177, Cargo5, TypeScript and build successful; docs readback and diff check passed.

## Verification and preservation evidence
Installed nativeDashboard audio time 0.098 -> 1.115 seconds; nativeTimer 0 -> 0.836 seconds, both paused false/readyState4. Backup: `C:/Users/dream/Documents/KURONE-KO-backup-before-1.1.1-20261008-205456`. Installer: `src-tauri/target/release/bundle/nsis/KURONE-KO_1.1.1_x64-setup.exe`, unsigned. User upgrade complete; live settings/history match backup. No broad process kills or unrelated Chrome/Vite termination.

## Next step
Implementation, installation and verification are complete within the stated limits. Local units: `3433fb5` harness (size exception), `2eecc5d` versions/docs. This continuity document is a separate documentation unit. Suggested future delivery slices follow that order; no PRs were opened and main remains untouched. Next human decision: push/PR or publish v1.1.1; neither is authorized. Native review was unavailable before authority creation; there is no receipt/approval. Physical Alt+F4 and installed UI Exit remain untested. The original intermittent 1.1.0 cause remains unproven, not a claimed new production fix.
