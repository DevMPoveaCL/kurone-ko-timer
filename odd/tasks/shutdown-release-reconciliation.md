# ODD: Shutdown and Release Reconciliation

## Objective
Audit Windows shutdown with real playlist audio and reconcile roadmap and versions without speculative lifecycle changes. Preserve user settings/history and the two-window architecture.

## Scope and configuration
- Implementation branch: `fix/shutdown-release-reconciliation`; base `7bd0e5b`.
- Strict TDD: existing project configuration; Vitest, Cargo and Playwright.
- Delivery: stacked-to-main; the maintainer accepted the coherent harness size exception (893 additions / 54 deletions).
- Subsequent maintainer approvals covered commits, data-preserving installation, PRs, merge and publication.
- Preserve pre-existing local index files; do not include generated installers or private host details in repository changes.

## Completed work
### SHUT-1 — Trustworthy shutdown evidence
Status: complete; commit `3433fb5`, merged in PR #11.
Route: delegated implementation and independent verification.
- [x] Track actual application identity and scoped WebView ancestry.
- [x] Assert real playlist playback before close; guard native window selection and fixture cleanup.
- [x] Persist fixture ownership independently from test results and isolate the test endpoint.
- [x] Verify debug dashboard Exit and native dashboard/timer close.
Checks: 177 frontend tests, 21 focused harness tests, TypeScript and targeted Playwright passed independently. Native review could not start; no native approval or receipt is claimed.

### SHUT-2 — Release and installed verification
Status: complete; production lifecycle unchanged.
Route: delegated build and runtime verification, followed by maintainer manual testing.
- [x] Verify generated release and installed 1.1.1 native close with actual audio playback and scoped process termination.
- [x] Back up and verify application data before the interactive upgrade.
- [x] Preserve settings/history; the timer snapshot changed only its save timestamp.
- [x] Confirm no surviving application processes after the installed smoke.
- [x] Record maintainer confirmation of physical Alt+F4 and dashboard Exit, with no remaining processes visible in Windows Task Manager.
Limit: the original intermittent 1.1.0 cause was not reproduced; no newly implemented production shutdown fix is claimed.

### REL-1 — Versions and project documentation
Status: complete; commit `2eecc5d`, merged in PR #12. Initial continuity record `9c17eae` merged in PR #13.
Route: delegated documentation and manifest updates.
- [x] Align application manifests and lock entries to 1.1.1.
- [x] Reconcile completed roadmap items and superseded shutdown guidance.
- [x] Verify manifests, 177 frontend tests, 5 Rust tests, TypeScript and release build.
- [x] Integrate PRs #11–13 with successful required CI; close issue #10.
- [x] Publish [v1.1.1](https://github.com/DevMPoveaCL/kurone-ko-timer/releases/tag/v1.1.1) from `8eb6aaf` with the verified unsigned NSIS installer.

### DOC-1 — Publication closeout
Status: complete; publication documentation integrated in PR #14 with successful required CI.
Route: delegated writer and independent documentation/privacy verification.
- [x] Remove stale unpublished status without changing the README's public-facing structure.
- [x] Record published release and completed manual verification in roadmap/journal.
- [x] Remove personal backup/workspace details from affected documentation.
- [x] Verify the bounded documentation diff and integrate its documentation-only PR with successful CI.
Checks: documentation readback, privacy scan, diff check and required GitHub CI. No application or installer changes.

## Next step
This feature is closed. Further functionality requires a separate ODD scope. Release publication, installed shutdown verification and documentation closeout are complete; native review authority was never created.
