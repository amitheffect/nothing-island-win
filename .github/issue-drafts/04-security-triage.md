title: Security: triage the reported vulnerabilities
labels: security, priority: high
milestone: v1.1
state: open
---
## What we know
- `npm install` reports **2 high** severity vulnerabilities in dependencies.
- More findings were reported (Dependabot / scans). **Please paste each one as a comment** (package, advisory ID, severity, path).

## Plan
1. Run `npm audit` and `npm audit --omit=dev`. Note which findings are in **build-only tools** (electron-builder) vs. what actually ships in the app (Electron itself only — the app has no runtime npm dependencies).
2. Update Electron to the latest supported release and electron-builder to the latest; re-run audit.
3. For anything left: confirm it isn't reachable from the app, or pin an override in `package.json` (`"overrides"`).
4. Enable **Dependabot alerts + security updates** and **CodeQL** for JavaScript on the repo.
5. Add `SECURITY.md` (how to report privately: GitHub → Security → Report a vulnerability).
6. Re-check the app's own hardening is still in place: `contextIsolation`, `sandbox`, CSP, IPC allowlist (`SYS_ALLOWED`), `open` only allows Windows Settings pages, calendar link encrypted with DPAPI.

## Done when
- [ ] `npm audit --omit=dev` is clean; dev-only findings documented here.
- [ ] Dependabot + CodeQL on; `SECURITY.md` added.
