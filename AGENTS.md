# Agent Guidelines

Netprobe is a generic, self-hostable tool. Keep organisation-, host-, and vendor-account-specific
values out of the repository; they belong in a deployment's `config/netprobe.yaml`.

## Layout

- `src/server` — Fastify API, curl probe engine (`curl.ts`), failure classification
  (`classify.ts`), run orchestration (`runner.ts`), SQLite store (`db.ts`), presets.
- `src/shared/types.ts` — the API contract; the only types shared by server and web.
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
- Add focused tests for classification and config parsing changes.
- Conventional commits; commit whenever typecheck and build pass.

## Commands

```bash
pnpm dev
pnpm build
pnpm check   # lint, format:check, typecheck, test
```
