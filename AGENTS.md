# Agent Guidelines

Netprobe is a generic, self-hostable tool. Keep organisation-, host-, and vendor-account-specific
values out of the repository; they belong in a deployment's `config/netprobe.yaml`.

## Layout

- `src/server` — Fastify API, curl probe engine (`curl.ts`), failure classification
  (`classify.ts`), run orchestration (`runner.ts`), SQLite store (`db.ts`), presets.
- `src/shared/types.ts` — the API contract; the only types shared by server and web.
- `src/shared/stun.ts` — public STUN servers used by both the host's probes and the browser check.
- `src/shared/resolvers.ts` — groups DNS resolver observations by network for the Egress page.
- `src/server/host.ts`, `src/server/identity.ts` — Host page snapshot and Egress page checks
  (third-party IP information sources, reputation lookups, DNS resolver identification).
- `src/web` — React client (Base UI + Tailwind 4). Visual tokens live in `styles.css`.
- `test` — Vitest; `fault-server.ts` provides misbehaving endpoints for real-curl tests.

The server runs TypeScript directly with Node's type stripping: use `.ts` import extensions and
erasable syntax only (no enums, namespaces, or parameter properties).

## Working agreements

- Measurements must never look better than they were: keep failed attempts, never fold retries
  into success, and distinguish reachable / expected / transferred.
- Anything that may carry credentials (URLs, proxies, curl messages) goes through `redact.ts`
  before it is stored, logged, or returned.
- Targets come from config only; do not add API endpoints that accept arbitrary URLs.
- UI: no pointer cursors, chrome text is not selectable (opt in with `select-text` for long-form
  content), and hover states use the `snap` utility (instant in, fast out).
  Figures are tabular everywhere (set on `body`); do not switch them back to proportional.
- Hover details go through `ui/tooltip.tsx`: a DataTable column's `tooltip` (grouped per column)
  or `InfoHint` (all hints share one group). Each group has one popup root and its own warm-up
  timer; whole cells or label + icon are the hit targets, and popups ignore the pointer.
- Tables: headers stick below the page header through a detached header row; wide tables scroll
  sideways with an overlay scrollbar per section (shared position, separate interaction state).
  A control whose use changes its neighbours sits in a stable (leading) slot so it never moves.
- The config format is defined once, in zod (`src/server/config.ts`), with a description on
  every field. After changing it or the presets, run `pnpm schema` to regenerate
  `config/netprobe.schema.json`; a test fails while the two disagree.
- Add focused tests for classification and config parsing changes.
- Conventional commits; commit whenever typecheck and build pass.

## Commands

```bash
pnpm dev
pnpm build
pnpm check   # lint, format:check, typecheck, test
```
