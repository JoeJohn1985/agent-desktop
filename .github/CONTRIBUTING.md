# Contributing to Copilot Desktop

Thanks for contributing! Please follow this workflow to keep the codebase clean and reviewable.

## Workflow

### 1. Stay up to date
Always start from the latest `main`:
```powershell
git checkout main
git pull origin main
```

### 2. Create a feature branch
Use a descriptive branch name:
```powershell
git checkout -b feature/my-feature     # new features
git checkout -b fix/bug-description    # bug fixes
git checkout -b docs/update-readme     # documentation
```

### 3. Make your changes
- Keep commits small and focused
- Use clear commit messages following [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat:` — new feature
  - `fix:` — bug fix
  - `docs:` — documentation only
  - `refactor:` — code change without feature/fix
  - `chore:` — tooling, dependencies

### 4. Push and open a Pull Request
```powershell
git push origin feature/my-feature
```
Then open a Pull Request on GitHub against `main`.

- Write a clear PR description: **what** changed and **why**
- Link related issues if applicable
- Wait for review before merging

### 5. Do not push directly to `main`
The `main` branch is protected. All changes must go through a Pull Request.

## Prerequisites

See [README.md](../README.md) for setup instructions.

## Questions?

Open an issue or start a discussion on GitHub.

## Versioning

This project follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`):

| Change type | Version bump | Example |
|---|---|---|
| Bugfix, small improvement | `PATCH` | `0.9.0` → `0.9.1` |
| New feature (backwards-compatible) | `MINOR` | `0.9.0` → `0.10.0` |
| Breaking change or planned release | `MAJOR` | `0.9.0` → `1.0.0` |

**Until `1.0.0`:** The project is in pre-release (`0.x.x`). Breaking changes may appear in MINOR bumps.

**Who bumps the version?**
The maintainer/Copilot agent assesses each change and proposes a version bump before pushing. Contributors do not need to change the version themselves — mention it in your PR description if you think it warrants a bump.

**Road to `1.0.0`** requires:
- [ ] Code Review
- [ ] QA / Testing
- [ ] Security Audit
- [ ] Full Documentation

