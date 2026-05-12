# Portable Distribution & Auto-Update — Maintainer Guide

This document explains **how Copilot Desktop is packaged for internal GEBIT
distribution** and **how the in-app auto-update flow works**. It is intended
for maintainers; end-user documentation lives in `build/portable/PORTABLE_README.txt`
(which ships inside the ZIP).

---

## 1. Why a portable ZIP

| Constraint | Decision |
|---|---|
| GEBIT-internal only | Repository stays private on GitHub |
| 0 € licensing / certificate cost | No code-signing CA, no MS Store, no Apple Dev Account |
| No additional infrastructure | Build via GitHub Actions, distribution via GitHub Releases |
| No admin rights on user machine | Portable ZIP, runs from any folder |
| Single dependency | A GitHub account with Copilot subscription |

Result: a **signature-free ZIP** users can extract anywhere and launch via
`start.bat`. SmartScreen will warn once on first launch (acceptable for
internal distribution).

---

## 2. Bundle layout

```
copilot-desktop-vX.Y.Z-portable.zip
└── copilot-desktop-vX.Y.Z-portable\
    ├── start.bat                ← stable launcher (NEVER overwritten)
    ├── PORTABLE_README.txt      ← end-user docs
    ├── current\                 ← active version
    │   ├── app\                 ← electron-builder --dir output
    │   │   ├── copilot-desktop.exe
    │   │   └── resources\app.asar
    │   ├── tools\gh\bin\gh.exe  ← portable GitHub CLI
    │   └── VERSION.txt          ← version + build metadata
    └── _staged\                 ← created by the in-app updater
        ├── pending-update.json  ← commit marker for the next switch
        └── vX.Y.Z\              ← ready-to-promote new version
```

Key invariant: at any moment **either the old or the new `current\`
exists** — never a half-written state. `start.bat` is the only stable
entry point and is never replaced by an update.

---

## 3. Build pipeline

### 3.1 Local build (one-liner)

```powershell
npm install
npm run dist:portable
# → dist-portable\copilot-desktop-vX.Y.Z-portable.zip
# → dist-portable\build-YYYYMMDD-HHMMSS.log
```

### 3.2 What `dist:portable` does (build/portable/build-portable.ps1)

| Step | Action |
|---|---|
| 1 | Read `version` from `package.json`, derive `bundleName` and stage path |
| 2 | Clean `dist-portable\<bundleName>\` and create `current\` |
| 3 | `npx electron-builder --win dir` → copy `dist\win-unpacked` to `current\app\` |
| 4 | Download `gh_<version>_windows_amd64.zip` from `cli/cli` releases (cached under `dist-portable\_cache\`); extract to `current\tools\gh\` |
| 5 | Copy `start.bat`, `PORTABLE_README.txt` to bundle root; write `current\VERSION.txt` |
| 6 | Compress to `dist-portable\<bundleName>.zip` |

Every step is wrapped in `Invoke-Step` and logged with timestamp + outcome.
On failure the script aborts with a stack trace in the log.

### 3.3 CI release (PR-B — `.github/workflows/release.yml`)

The release workflow runs on a `windows-latest` runner and is the
**canonical way** to produce a distributable ZIP. Local builds are for
development only (see §6.2 for host requirements).

**Trigger:** push of an annotated tag matching `v*.*.*`, or a manual
`workflow_dispatch` from the Actions UI (for dry-runs).

**Pipeline:**
| Step | Action |
|---|---|
| 1 | Resolve tag → version |
| 2 | `actions/checkout@v4` (full history) |
| 3 | Assert `package.json` version equals tag version (fails the build if drifted) |
| 4 | `actions/setup-node@v4` (Node 20, npm cache) |
| 5 | `npm ci --no-audit --no-fund` |
| 6 | `npm test -- --ci` |
| 7 | `npm run dist:portable` (with `CSC_IDENTITY_AUTO_DISCOVERY=false`) |
| 8 | Locate `*portable*.zip` under `dist-portable\` |
| 9 | Always upload ZIP as workflow artifact (30 d retention) — visible even without a Release |
| 10 | Publish GitHub Release via `softprops/action-gh-release@v2` and attach the ZIP. Prerelease flag is set automatically for tags containing `-` (e.g. `v1.0.0-rc1`). |

**Required repo settings (Matthias, one-time, already done):**
- Settings → Actions → General: enable Actions
- Workflow permissions: Read and write
  (the workflow also sets `permissions: contents: write` explicitly as a
  belt-and-braces defense against default-permission drift)

**Cutting a release** becomes:
```powershell
npm version minor                 # bumps package.json + creates an annotated tag
git push origin main --follow-tags
# → workflow runs, ZIP appears at:
#    https://github.com/<owner>/<repo>/releases/latest
```

**Dry-running the workflow** without publishing a Release:
- Actions tab → "Release Portable ZIP" → "Run workflow"
- Enter a tag name (e.g. `v0.16.2-test`) and leave `publish=false`
- The ZIP is still uploaded as a workflow artifact for download.

---

## 4. Launcher (`start.bat`)

Run order on every launch:

1. Initialise paths (`BUNDLE_ROOT`, `CURRENT_DIR`, `STAGED_DIR`, `OLD_DIR`).
2. Open log file under `%LOCALAPPDATA%\copilot-desktop\logs\start-YYYYMMDD-HHMMSS.log`.
3. **Apply pending update** (see §5) if `_staged\pending-update.json` exists.
4. Sanity-check `current\app\copilot-desktop.exe` and `current\tools\gh\bin\gh.exe`; abort with clear error + log path otherwise.
5. Log `gh --version`, `gh auth status`. If no session → interactive `gh auth login --web`.
6. Ensure `gh-copilot` extension is installed.
7. `start "" current\app\copilot-desktop.exe` (detached).

All branches log decisions and exit codes; a single log file is enough for
a support ticket.

---

## 5. Auto-update flow (Firefox-style)

> The in-app updater itself is **not yet shipped** (PR-C). The launcher
> already understands its output, so the bundle layout is stable.

```
            ┌──────────────────────────────────┐
            │ App running, current\ vA.B.C     │
            └──────────────┬───────────────────┘
                           │ periodic check (e.g. every 6 h)
                           ▼
       gh api repos/.../releases/latest  (token from `gh auth token`)
                           │
              new tag vX.Y.Z > vA.B.C ?
                           │ yes
                           ▼
        download portable ZIP asset to %TEMP%
                           │
                           ▼
     extract into  _staged\vX.Y.Z\
                           │
                           ▼
    write _staged\pending-update.json
        { "version": "X.Y.Z", "stagedAt": "...", "sha256": "..." }
                           │
                           ▼
    in-app banner: "Update vX.Y.Z bereit — Neustart"
                           │ user clicks Restart (or restarts later)
                           ▼
   ── start.bat next launch ─────────────────
       :apply_pending_update
         ren  current\        _old\
         move _staged\vX.Y.Z  current\
         del  _staged\pending-update.json
         start /b cleanup _old\ in background
                           │
                           ▼
   App starts on vX.Y.Z; old version garbage-collected
```

### Properties guaranteed

- **Atomic**: the `move`/`ren` is the commit point. If anything fails before, the launcher rolls back (`_old` → `current`) and logs.
- **Idempotent**: re-running `start.bat` without a marker is a no-op. A leftover `_old\` from a previous run is cleaned up on the next launch.
- **Recoverable**: a failed switch leaves a log entry under `%LOCALAPPDATA%\copilot-desktop\logs\start-*.log`. Worst case: user re-extracts the ZIP.
- **Userdata-safe**: nothing under `%APPDATA%\GitHub CLI\`, `%USERPROFILE%\.copilot[-desktop]\` is touched.

### What lives where

| Path | Purpose | Survives update? |
|---|---|---|
| `<bundle>\start.bat`               | Launcher                | ✅ never overwritten |
| `<bundle>\current\`                | Active app version      | ❌ replaced on update |
| `<bundle>\_staged\vX.Y.Z\`         | Staged next version     | promoted on next launch |
| `%APPDATA%\GitHub CLI\`            | gh login token          | ✅ |
| `%USERPROFILE%\.copilot-desktop\`  | App config (folders.json) | ✅ |
| `%USERPROFILE%\.copilot\`          | Skills, agents, sessions | ✅ |
| `%LOCALAPPDATA%\copilot-desktop\logs\` | Launcher + updater logs | ✅ |

---

## 6. Testing

| Test | Type | Location |
|---|---|---|
| Build-config schema, layout, launcher invariants | Jest static checks (33 tests) | `__tests__/build-config.test.js` |
| Existing IPC / HTML integrity | Jest | `__tests__/integrity.test.js` |
| End-to-end launch | Playwright | `e2e/app.spec.js` |
| Local portable build | Manual (see §6.2) | `npm run dist:portable` |
| Launcher atomic-switch smoke test | Manual (PowerShell) | see §6.1 |

### 6.1 Manual launcher smoke test

```powershell
$tmp = Join-Path $env:TEMP "cpd-launcher-test"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Copy-Item build\portable\start.bat $tmp

# Scenario A: missing current\ → expect graceful failure + log
(echo `n) | cmd /c "$tmp\start.bat"

# Scenario B: pending update with valid staged version → expect atomic switch
New-Item -ItemType Directory -Force -Path "$tmp\current"                | Out-Null
New-Item -ItemType Directory -Force -Path "$tmp\_staged\v0.16.0\app"    | Out-Null
New-Item -ItemType File      -Force -Path "$tmp\_staged\v0.16.0\app\copilot-desktop.exe" | Out-Null
New-Item -ItemType Directory -Force -Path "$tmp\_staged\v0.16.0\tools\gh\bin" | Out-Null
New-Item -ItemType File      -Force -Path "$tmp\_staged\v0.16.0\tools\gh\bin\gh.exe" | Out-Null
'{"version":"0.16.0"}' | Out-File "$tmp\_staged\pending-update.json"
(echo `n) | cmd /c "$tmp\start.bat"

# Verify: $tmp\current\app\copilot-desktop.exe exists, $tmp\_staged\ is empty
```

### 6.2 Local portable build — host requirements

`npm run dist:portable` runs end-to-end **only on a host that has both**:

| Requirement | Why | How to provide |
|---|---|---|
| **Visual Studio Build Tools** (C++ workload) or VS 2019+ | electron-builder rebuilds `node-pty` against the Electron ABI via `node-gyp` | Visual Studio Installer → "Desktop development with C++" |
| **Symlink privileges** for current user | electron-builder extracts `winCodeSign` archive containing macOS dylib symlinks | Windows Settings → For Developers → Developer Mode = On (no admin needed), or run shell elevated |

On a host without these, `dist:portable` aborts cleanly with the exact root
cause in `dist-portable\build-*.log`. The bundle layout, launcher, and
electron-builder config are still verifiable via Jest
(`__tests__/build-config.test.js`, 33 tests).

**On the GitHub-Actions Windows runner both requirements are met out of the
box**, so the CI workflow (PR-B) is the primary build path. Local builds
are a debugging convenience only.

---

## 7. Rollback strategy

| Layer | Rollback |
|---|---|
| **PR not yet merged** | Close PR + delete branch — main untouched |
| **PR merged, no release cut** | `git revert <merge-sha>` |
| **Release cut, users on broken version** | Mark broken release "pre-release" + cut a new patch release; updater promotes the patch on next launch |
| **User-side broken update** | Re-extract a known-good ZIP into a new folder (logs in `%LOCALAPPDATA%` survive) |

---

## 8. Known limitations / follow-ups

- Windows-only for now. macOS/Linux can be added as additional CI targets.
- `preferences.json` still lives in the repo root and is touched at runtime (separate follow-up: move to `%APPDATA%`).
- The in-app updater (PR-C) is not yet implemented.
- SmartScreen warning on first launch — acceptable for internal distribution; would require code-signing to remove.
