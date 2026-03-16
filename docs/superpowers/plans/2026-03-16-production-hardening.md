# Auth Service Production Hardening — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform auth-service from prototype to production-ready: Redis rate limiting, deep health checks, sliding sessions, security hardening, deployment config, dev tooling, and documentation.

**Architecture:** Layered architecture (routes to services to infrastructure) with manual DI. All infrastructure behind interfaces with in-memory fakes for testing. Changes maintain this pattern — new infrastructure gets new fakes.

**Tech Stack:** Bun, Elysia, Drizzle ORM, Postgres, Redis, RabbitMQ, amqplib

**Spec:** `docs/superpowers/specs/2026-03-16-production-hardening-design.md`

---

## File Map

**New files:**
- `src/shared/utils.js` — maskEmail, extractBearerToken, secureCompare
- `src/infrastructure/redis/redis-rate-limiter.js` — Lua-script fixed window counter
- `src/infrastructure/rabbitmq/connection-manager.js` — reconnecting RabbitMQ wrapper
- `src/infrastructure/http/routes/oauth-exchange-route.js` — POST /auth/oauth/exchange
- `scripts/dev.js` — port-finding dev launcher
- `eslint.config.js` — flat config
- `.prettierrc` — code style
- `.husky/pre-commit` — lint-staged hook
- `.lintstagedrc` — staged file linting
- `.github/workflows/ci.yml` — test + lint CI
- `README.md` — project overview
- `docs/architecture.md` — system design
- `docs/api-reference.md` — endpoint docs
- `docs/deployment.md` — Coolify + local dev
- `docs/decisions.md` — ADRs

**New test fakes:**
- Update `test/fakes/in-memory-session-store.js` — add getAndRefresh
- Create `test/fakes/fake-redis-rate-limiter.js` — Map-based rate limiter matching Redis interface

**Modified files:**
- `src/index.js` — hoist connections, graceful shutdown, wire new deps, security headers, error handler, access logging, request ID, body size limit
- `src/config.js` — remove Apple, add CLIENT_URL to required
- `src/infrastructure/http/routes/health-routes.js` — deep check
- `src/infrastructure/http/routes/auth-routes.js` — TypeBox, shared utils, dual login limiters
- `src/infrastructure/http/routes/validate-routes.js` — TypeBox, secureCompare
- `src/infrastructure/http/routes/otp-routes.js` — TypeBox, separate limiters
- `src/modules/credentials/otp-service.js` — replace local maskEmail with import from shared utils
- `src/infrastructure/http/routes/oauth-routes.js` — remove Apple, state verification, auth code redirect
- `src/infrastructure/redis/redis-session-store.js` — parallel deletion, getAndRefresh
- `src/modules/session/session-service.js` — use getAndRefresh
- `src/infrastructure/rabbitmq/event-publisher.js` — use connection manager
- `Dockerfile` — curl + HEALTHCHECK
- `docker-compose.yml` — ports, env, rabbitmq
- `package.json` — scripts, devDeps
- `.gitignore` — verify .env covered, add .husky, .prettierrc patterns if needed
- `.env.example` — updated vars
- `test/e2e/auth-flow.test.js` — update for new API shapes

**Important notes:**
- **Sync-to-async migration:** The old `RateLimiter.check()` is synchronous. The new `RedisRateLimiter.check()` and `FakeRedisRateLimiter.check()` are async. ALL route code calling `rateLimiters.*.check()` must use `await`. E2E test overrides must use `FakeRedisRateLimiter` (async) instead of the old synchronous `RateLimiter`.
- **Broken intermediate state:** After Task 6 (CLIENT_URL required), the full e2e test suite will fail until Task 10 updates the test config. Only run `bun test test/modules/config.test.js` at Task 6 Step 4, not the full suite.
- **Rate limiters are NOT in the DI container.** They are created directly in `src/index.js` and passed via the `deps` object. This is intentional — they don't need the indirection of the container.

**Deleted files:**
- `index.ts`
- `src/infrastructure/rabbitmq/event-consumer.js`

---

## Chunk 1: Foundation and Infrastructure

### Task 1: Shared Utilities

**Files:**
- Create: `src/shared/utils.js`
- Create: `test/modules/shared/utils.test.js`

- [ ] **Step 1: Write failing tests for shared utils**

Create `test/modules/shared/utils.test.js` with tests for:
- `maskEmail`: masks local part after 3 chars, handles short local parts
- `extractBearerToken`: extracts from valid Bearer header, returns null for missing/invalid/empty
- `secureCompare`: returns true for matching, false for non-matching, false for length mismatch

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/modules/shared/utils.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement shared utils**

Create `src/shared/utils.js` with:
- `maskEmail(email)` — split on @, keep first 3 chars of local + `***@domain`
- `extractBearerToken(header)` — check null, check startsWith `Bearer `, slice(7), check length > 0
- `secureCompare(a, b)` — check types, check lengths match, use `crypto.timingSafeEqual` with Buffer.from

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/modules/shared/utils.test.js`
Expected: PASS — all tests

- [ ] **Step 5: Commit**

```bash
git add src/shared/utils.js test/modules/shared/utils.test.js
git commit -m "feat: extract shared utilities (maskEmail, extractBearerToken, secureCompare)"
```

---

### Task 2: Redis-Backed Rate Limiter

**Files:**
- Create: `src/infrastructure/redis/redis-rate-limiter.js`
- Create: `test/modules/rate-limit/redis-rate-limiter.test.js`
- Create: `test/fakes/fake-redis-rate-limiter.js`

- [ ] **Step 1: Create fake rate limiter and tests**

Create `test/fakes/fake-redis-rate-limiter.js` — async `check(key)` method matching the Redis interface. Uses Map internally with `{ count, start }` entries. Returns `{ allowed, remaining, retryAfterMs }`.

Create `test/modules/rate-limit/redis-rate-limiter.test.js` testing:
- Allows requests under limit
- Blocks after max attempts
- Isolates different keys
- Returns retryAfterMs when blocked

Note: all `check()` calls must be awaited since the real implementation is async.

- [ ] **Step 2: Run tests**

Run: `bun test test/modules/rate-limit/redis-rate-limiter.test.js`
Expected: PASS

- [ ] **Step 3: Implement Redis rate limiter**

Create `src/infrastructure/redis/redis-rate-limiter.js`:
- Lua script: `INCR key; if count == 1 then EXPIRE key windowSeconds; return count`
- `check(key)` calls `redis.eval(LUA_SCRIPT, 1, fullKey, windowSeconds)` (note: `redis.eval` is the standard Redis EVAL command for server-side Lua execution, not JS eval)
- If count > maxAttempts: get TTL, return `{ allowed: false, remaining: 0, retryAfterMs: ttl * 1000 }`
- Otherwise: `{ allowed: true, remaining: maxAttempts - count, retryAfterMs: 0 }`

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/redis/redis-rate-limiter.js test/modules/rate-limit/redis-rate-limiter.test.js test/fakes/fake-redis-rate-limiter.js
git commit -m "feat: add Redis-backed rate limiter with atomic Lua script"
```

---

### Task 3: Sliding Sessions in Session Store

**Files:**
- Modify: `src/infrastructure/redis/redis-session-store.js`
- Modify: `test/fakes/in-memory-session-store.js`
- Modify: `src/modules/session/session-service.js`

- [ ] **Step 1: Add getAndRefresh to in-memory session store fake**

In `test/fakes/in-memory-session-store.js`, add:
- `getAndRefresh(token, _fullTtlSeconds)` — returns `store.get(token) || null` (fakes ignore TTL)
- Add to return object

- [ ] **Step 2: Add getAndRefresh to real Redis session store**

In `src/infrastructure/redis/redis-session-store.js`, add:
- `getAndRefresh(token, fullTtlSeconds)`:
  1. GET the session data
  2. If null, return null
  3. TTL the session key
  4. If ttl > 0 and ttl < (fullTtlSeconds * 0.85): EXPIRE both session key and user-sessions set
  5. Return parsed data
- Add to return object

- [ ] **Step 3: Update session-service.js validate**

Change `validate()` to call `sessionStore.getAndRefresh(token, sessionTtlHours * 3600)` instead of `sessionStore.get(token)`.

- [ ] **Step 4: Run session tests**

Run: `bun test test/modules/session/session-service.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/redis/redis-session-store.js src/modules/session/session-service.js test/fakes/in-memory-session-store.js
git commit -m "feat: add sliding sessions — refresh TTL on active user validation"
```

---

### Task 4: Atomic Session Deletion + Deep Health Check

**Files:**
- Modify: `src/infrastructure/redis/redis-session-store.js`
- Modify: `src/infrastructure/http/routes/health-routes.js`

- [ ] **Step 1: Update deleteAllForUser to use concurrent operations**

In `redis-session-store.js`, replace the sequential loop with `Promise.all`. Note: Bun's `RedisClient` does not expose a `.pipeline()` method. `Promise.all` with individual DEL calls achieves concurrent execution (Bun's Redis client may auto-pipeline these under the hood). This is a significant improvement over the sequential loop.

```js
await Promise.all([
  ...tokens.map((token) => redis.del(SESSION_PREFIX + token)),
  redis.del(USER_SESSIONS_PREFIX + userId),
])
```

- [ ] **Step 2: Rewrite health-routes.js with deep check**

Import `sql` from drizzle-orm. Accept `{ db, redis }` as second param. Ping both with 3s timeout using `Promise.race`. Return 503 if either fails. Include `checks: { database, redis }` in response.

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/redis/redis-session-store.js src/infrastructure/http/routes/health-routes.js
git commit -m "feat: atomic session deletion, deep health check with Postgres/Redis probes"
```

---

### Task 5: RabbitMQ Connection Manager

**Files:**
- Create: `src/infrastructure/rabbitmq/connection-manager.js`
- Modify: `src/infrastructure/rabbitmq/event-publisher.js`

- [ ] **Step 1: Create connection manager**

`RabbitMQConnectionManager({ url, log })`:
- `connect()` — creates connection + channel, attaches error/close listeners, resets publishers
- `scheduleReconnect()` — exponential backoff (1s to 30s max), retries until `closed` flag
- `getChannel()` — returns current channel or null
- `isConnected()` — boolean
- `registerPublisher(publisher)` — tracks publishers to reset on reconnect
- `close()` — sets closed flag, closes channel + connection

- [ ] **Step 2: Update event-publisher.js**

Change from receiving raw channel to receiving connectionManager:
- `getChannel()` on each publish
- If no channel, log warning, return false
- `reset()` method sets `ready = false`
- Register self with connection manager via `connectionManager.registerPublisher({ reset })`

- [ ] **Step 3: Run tests**

Run: `bun test`
Expected: PASS (existing tests use FakeEventPublisher)

- [ ] **Step 4: Commit**

```bash
git add src/infrastructure/rabbitmq/connection-manager.js src/infrastructure/rabbitmq/event-publisher.js
git commit -m "feat: add RabbitMQ connection manager with auto-reconnect"
```

---

### Task 6: Config Changes and Code Cleanup

**Files:**
- Modify: `src/config.js`
- Modify: `test/modules/config.test.js`
- Delete: `index.ts`
- Delete: `src/infrastructure/rabbitmq/event-consumer.js`

- [ ] **Step 1: Update config.js**

Add `CLIENT_URL` to REQUIRED array. Remove `apple` config block. Remove default value for `clientUrl` — use `env.CLIENT_URL` directly.

- [ ] **Step 2: Update config tests**

Add `CLIENT_URL` to all test env fixtures. Add test that missing `CLIENT_URL` throws.

- [ ] **Step 3: Delete dead code**

```bash
rm index.ts src/infrastructure/rabbitmq/event-consumer.js
```

- [ ] **Step 4: Run tests**

Run: `bun test test/modules/config.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/modules/config.test.js
git rm index.ts src/infrastructure/rabbitmq/event-consumer.js
git commit -m "chore: remove Apple config and dead code, make CLIENT_URL required"
```

---

## Chunk 2: Security

### Task 7: OAuth State Verification and Authorization Code Exchange

**Files:**
- Modify: `src/infrastructure/http/routes/oauth-routes.js`
- Create: `src/infrastructure/http/routes/oauth-exchange-route.js`

- [ ] **Step 1: Rewrite oauth-routes.js**

Remove Apple routes entirely. Remove `userService` from deps (no longer needed — session data comes from oauthService.handleCallback). Add Redis state storage:
- `GET /auth/google`: store `oauth-state:<uuid>` in Redis with 5min TTL, redirect
- `GET /auth/google/callback`: verify state exists in Redis, delete it. On success, store session as `oauth-code:<uuid>` with 30s TTL, redirect to `${clientUrl}?code=<uuid>`

Accept `redis` in deps alongside `oauthService` and `clientUrl`.

- [ ] **Step 2: Create oauth-exchange-route.js**

`POST /auth/oauth/exchange` with TypeBox body validation (`code: t.String({ minLength: 36, maxLength: 36 })` — UUIDs are always 36 chars):
- Look up `oauth-code:<code>` in Redis
- If missing: 401
- Delete key, parse JSON, return session data

- [ ] **Step 3: Commit**

```bash
git add src/infrastructure/http/routes/oauth-routes.js src/infrastructure/http/routes/oauth-exchange-route.js
git commit -m "feat: OAuth state verification, auth code exchange, remove Apple routes"
```

---

### Task 8: Security Headers, Error Handler, Body Validation

**Files:**
- Modify: `src/index.js` (middleware hooks)
- Modify: `src/infrastructure/http/routes/auth-routes.js`
- Modify: `src/infrastructure/http/routes/validate-routes.js`
- Modify: `src/infrastructure/http/routes/otp-routes.js`
- Modify: `src/modules/credentials/otp-service.js`
- Modify: `.gitignore`

- [ ] **Step 1: Add security headers + error handler to Elysia app in index.js**

`onBeforeHandle`: set X-Content-Type-Options, X-Frame-Options, HSTS, X-XSS-Protection, Referrer-Policy
`onError`: log error, return generic 500

- [ ] **Step 2: Update auth-routes.js**

- Import `{ t } from 'elysia'` and shared utils
- Remove local maskEmail
- Add TypeBox schemas to all 6 POST routes
- Replace bearer extraction with `extractBearerToken`
- Add dual login limiters (`login` by email + `login-ip` by IP)
- **IMPORTANT:** All `rateLimiters.*.check()` calls must now be `await`ed (async Redis calls)
- Add `Retry-After` header on 429 responses
- Remove manual null checks replaced by TypeBox

- [ ] **Step 3: Update validate-routes.js**

- Import `{ t } from 'elysia'` and shared utils
- Use `secureCompare` for service key
- Use `extractBearerToken` for bearer
- Add TypeBox body schema for the authorization header validation

- [ ] **Step 4: Update otp-routes.js**

- Import shared utils, remove local maskEmail
- Add TypeBox schemas
- Use `rateLimiters['otp-request']` and `rateLimiters['otp-verify']`
- **IMPORTANT:** `await` all `rateLimiters.*.check()` calls
- Add `Retry-After` headers

- [ ] **Step 5: Update otp-service.js**

- Replace local `maskEmail` definition with `import { maskEmail } from '../../shared/utils.js'`

- [ ] **Step 6: Verify .gitignore**

Check `.gitignore` includes `.env`. If not, add it.

- [ ] **Step 7: Commit**

```bash
git add src/index.js src/infrastructure/http/routes/auth-routes.js src/infrastructure/http/routes/validate-routes.js src/infrastructure/http/routes/otp-routes.js
git commit -m "feat: security headers, error handler, TypeBox validation, secureCompare"
```

---

## Chunk 3: Wire-up and Test Updates

### Task 9: Full src/index.js Rewrite

**Files:**
- Modify: `src/index.js`

- [ ] **Step 1: Update imports**

Add new imports at top of file:
```js
import { RedisRateLimiter } from './infrastructure/redis/redis-rate-limiter.js'
import { RabbitMQConnectionManager } from './infrastructure/rabbitmq/connection-manager.js'
import { oauthExchangeRoute } from './infrastructure/http/routes/oauth-exchange-route.js'
```
Remove the old `RateLimiter` import.

- [ ] **Step 2: Hoist connection references**

Move `db`, `redis`, `rabbitManager` declarations to the outer `createApp` scope (before the `if (!overrides.userRepository)` block):
```js
let db = null
let redis = null
let rabbitManager = null
```
Inside the block, assign to these variables instead of using `const`.

- [ ] **Step 3: Replace raw amqplib with connection manager**

Replace:
```js
const rabbitConn = await amqplib.connect(config.rabbitmq.url)
const rabbitChannel = await rabbitConn.createChannel()
```
With:
```js
rabbitManager = RabbitMQConnectionManager({ url: config.rabbitmq.url, log })
await rabbitManager.connect()
```
Update publisher registrations to pass `rabbitManager` instead of `rabbitChannel`.

- [ ] **Step 4: Wire Redis rate limiters**

Replace the old `new Map()` rate limiters with:
```js
const rateLimiters = overrides.rateLimiters || {
  login: RedisRateLimiter({ redis, prefix: 'login', maxAttempts: 10, windowSeconds: 900 }),
  'login-ip': RedisRateLimiter({ redis, prefix: 'login-ip', maxAttempts: 30, windowSeconds: 900 }),
  register: RedisRateLimiter({ redis, prefix: 'register', maxAttempts: 10, windowSeconds: 3600 }),
  'otp-request': RedisRateLimiter({ redis, prefix: 'otp-request', maxAttempts: 10, windowSeconds: 900 }),
  'otp-verify': RedisRateLimiter({ redis, prefix: 'otp-verify', maxAttempts: 10, windowSeconds: 900 }),
}
```

- [ ] **Step 5: Update route wiring**

Pass `{ db, redis }` to `healthRoutes`. Add `redis` to deps object. Wire `oauthExchangeRoute(app, deps)` after the other routes.

- [ ] **Step 6: Add middleware hooks**

Add `onBeforeHandle` (security headers), `derive` (requestId), `onAfterHandle` (access logging, skip /health), `onError` (global error handler).

- [ ] **Step 7: Add body size limit and graceful shutdown**

Set `maxRequestBodySize: 65536` in `app.listen()`. Add SIGTERM/SIGINT handlers that: stop server, close rabbitManager, close redis, close db (`db.$client.close()`), exit 0.

- [ ] **Step 8: Update return value**

Return `{ app, port, shutdown, connections: { db, redis, rabbitManager } }`.

- [ ] **Step 9: Commit**

```bash
git add src/index.js
git commit -m "feat: wire all production infrastructure in index.js"
```

```bash
git add src/index.js
git commit -m "feat: wire all production infrastructure in index.js"
```

---

### Task 10: Update E2E Tests and Fakes

**Files:**
- Modify: `test/e2e/auth-flow.test.js`
- Modify: `test/fakes/in-memory-session-store.js`

- [ ] **Step 1: Update session store fake**

Add `getAndRefresh` if not already done.

- [ ] **Step 2: Update e2e test**

- Add `CLIENT_URL` to test config
- Update rate limiter overrides: add `'login-ip'`, rename `otp` to `'otp-request'` and `'otp-verify'`
- Ensure all test passwords are 8+ characters
- Add mock db/redis for health check (or adjust createApp to skip health deps in test mode)
- Fix any assertions affected by TypeBox validation (422 instead of 400 for invalid bodies)

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add test/ src/
git commit -m "test: update e2e tests and fakes for production hardening"
```

---

## Chunk 4: Deployment and Developer Experience

### Task 11: Dockerfile, docker-compose, .dockerignore, .env.example

**Files:**
- Modify: `Dockerfile`, `docker-compose.yml`, `.env.example`
- Create: `.dockerignore`

- [ ] **Step 1: Update Dockerfile** — add curl install, HEALTHCHECK with 10s interval, 15s start-period
- [ ] **Step 2: Update docker-compose.yml** — add ports, env_file, RabbitMQ service with healthcheck
- [ ] **Step 3: Create .dockerignore** — exclude node_modules, .env, .git, test, docs, .github, .husky, scripts, config files
- [ ] **Step 4: Update .env.example** — add CLIENT_URL (required), remove APPLE_* vars
- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore .env.example
git commit -m "feat: production Dockerfile with HEALTHCHECK, full local dev docker-compose"
```

---

### Task 12: ESLint, Prettier, Husky, lint-staged

**Files:**
- Create: `eslint.config.js`, `.prettierrc`, `.husky/pre-commit`, `.lintstagedrc`
- Modify: `package.json`

- [ ] **Step 1: Install deps** — `bun add -d eslint @eslint/js globals prettier husky lint-staged`
- [ ] **Step 2: Create eslint.config.js** — flat config, recommended rules, node/bun globals
- [ ] **Step 3: Create .prettierrc** — single quotes, no semis, trailing commas, width 120
- [ ] **Step 4: Create .lintstagedrc** — prettier --write + eslint --fix on *.js
- [ ] **Step 5: Init Husky** — `bunx husky init`, write pre-commit hook
- [ ] **Step 6: Update package.json** — add all scripts (dev, lint, format, check, prepare)
- [ ] **Step 7: Format and lint entire codebase** — `bun run format && bun run lint:fix`
- [ ] **Step 8: Run tests** — `bun test` (verify formatting didnt break anything)
- [ ] **Step 9: Commit**

```bash
git add eslint.config.js .prettierrc .lintstagedrc .husky/ package.json bun.lock src/ test/
git commit -m "feat: add ESLint, Prettier, Husky, lint-staged"
```

---

### Task 13: Dev Script and GitHub Actions CI

**Files:**
- Create: `scripts/dev.js`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create dev script** — probe ports starting from PORT env or 3001, spawn bun --watch with found port
- [ ] **Step 2: Create CI workflow** — triggers on push/PR to main, setup Bun, install, lint, format check, test
- [ ] **Step 3: Commit**

```bash
git add scripts/dev.js .github/workflows/ci.yml
git commit -m "feat: add dev script with port-finding and GitHub Actions CI"
```

---

## Chunk 5: Documentation

### Task 14: README.md

- [ ] **Step 1: Write README.md** — overview, tech stack, prerequisites, quickstart, env vars table, project structure, links to docs
- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

### Task 15: Architecture Documentation

- [ ] **Step 1: Write docs/architecture.md** — layered design, DI, modules, data flows for registration/login/OAuth/OTP/session
- [ ] **Step 2: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: add architecture documentation"
```

### Task 16: API Reference

- [ ] **Step 1: Write docs/api-reference.md** — all 14 endpoints with method, path, auth, body, response, errors, rate limits
- [ ] **Step 2: Commit**

```bash
git add docs/api-reference.md
git commit -m "docs: add API reference"
```

### Task 17: Deployment Guide

- [ ] **Step 1: Write docs/deployment.md** — Coolify setup, rolling updates, local dev, database strategy, Redis separation
- [ ] **Step 2: Commit**

```bash
git add docs/deployment.md
git commit -m "docs: add deployment guide"
```

### Task 18: Architecture Decision Records

- [ ] **Step 1: Write docs/decisions.md** — 11 ADRs covering all major design choices
- [ ] **Step 2: Commit**

```bash
git add docs/decisions.md
git commit -m "docs: add architectural decision records"
```

---

## Chunk 6: Final Verification

### Task 19: Full Check Suite

- [ ] **Step 1: Run full check** — `bun run check` (lint + format + test)
- [ ] **Step 2: Fix any remaining issues**
- [ ] **Step 3: Run e2e test** — `bun test test/e2e/auth-flow.test.js`
- [ ] **Step 4: Commit fixes if needed**

```bash
git add -A
git commit -m "chore: fix lint and format issues from final verification"
```

### Task 20: Cleanup

- [ ] **Step 1: Remove superpowers specs/plans if desired**
- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "chore: production hardening complete"
```
