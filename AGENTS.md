# Agents.md — Project rules for AI agents

## Versioning

- Before **every commit**, bump the version in `package.json`.
- Patch version (e.g. 0.14.2 → 0.14.3) for bug fixes and small changes.
- Minor version (e.g. 0.14.x → 0.15.0) for new features or larger refactorings.
- Commit messages follow **Conventional Commits**: `type(scope): short description`
  (e.g. `feat(claude-code): ...`, `fix(acp): ...`). The version bump lands in
  the same commit but is not part of the message prefix.

## Git workflow

- Before committing, always run `git pull --rebase` to update the local state.
- After pushing, run `git pull --rebase` again to pull back any remote changes (e.g. CI).
- Order: **pull → commit → push → pull**
