# Auth Service Production Hardening — Design Spec

## Overview

Transform the auth-service from a working prototype into a production-ready authentication microservice. Covers reliability, security, deployment, developer experience, and documentation.

**Decisions made:**
- Shared Postgres cluster, separate databases per service
- Dedicated Redis instance for auth-service
- Coolify Dockerfile build pack (not docker-compose) for rolling updates
- Fixed window counter rate limiter (Redis Lua script: atomic INCR + EXPIRE)
- 8+ character password minimum, no complexity rules (NIST SP 800-63B)
- Remove Apple OAuth (implement later; keep `'apple'` in pgEnum — already migrated, harmless)

---

## Section 1: Infrastructure & Reliability

### 1.1 Redis-Backed Rate Limiter

**Current:** In-memory `Map` — resets on restart, useless with multiple replicas.

**New:** `src/infrastructure/redis/redis-rate-limiter.js` — fixed window counter using an atomic Lua script:

```lua
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
```

This eliminates the race condition between `INCR` and `EXPIRE` (if the process crashes between them, the key persists forever without the Lua approach).

Keys follow pattern `rl:<limiter>:<key>`.

**Limits:**

| Limiter | Key | Max Attempts | Window |
|---------|-----|-------------|--------|
| `login` | email | 10 | 15 min |
| `login-ip` | IP | 30 | 15 min |
| `register` | IP | 10 | 60 min |
| `otp-request` | email | 10 | 15 min |
| `otp-verify` | email | 10 | 15 min |

**Route-to-limiter mapping:**

| Route | Limiter(s) Used |
|-------|----------------|
| `POST /auth/login` | `login` (email) AND `login-ip` (IP). Check IP first (cheaper). Reject if **either** fails. Use the shorter `retryAfterMs` for the response. |
| `POST /auth/register` | `register` (IP) |
| `POST /auth/register/verify` | `otp-verify` (email) |
| `POST /auth/password/reset` | `otp-request` (email) |
| `POST /auth/otp/request` | `otp-request` (email) |
| `POST /auth/otp/verify` | `otp-verify` (email) |

Rate limit responses include `Retry-After` header (seconds, converted from `retryAfterMs`).

Interface: `{ check(key) -> { allowed, remaining, retryAfterMs } }` — same shape as current, drop-in replacement.

**Note on progressive penalty:** The fixed-window approach allows 10 attempts per 15 minutes indefinitely. This is an acceptable tradeoff — Argon2id hashing makes brute force impractical, and the rate limiter's purpose is to prevent abuse, not replace password security. Account lockout/exponential backoff can be added later if monitoring shows abuse patterns.

### 1.2 Deep Health Check

**Current:** Always returns 200 with uptime only.

**New:** `GET /health` pings Postgres (`SELECT 1`) and Redis (`PING`) with a **3-second timeout** per probe. Returns 200 if both succeed, 503 if either fails or times out. Response:

```json
{ "status": "ok", "service": "auth-service", "uptime": 42, "checks": { "database": "ok", "redis": "ok" } }
```

Signature changes from `healthRoutes(app)` to `healthRoutes(app, { db, redis })`. The call site in `src/index.js` is updated accordingly.

### 1.3 Sliding Sessions

**Current:** Fixed 7-day TTL from creation. Active users get logged out.

**New:** Sliding session logic lives in **`redis-session-store.js`** (infrastructure layer, not domain). New method `getAndRefresh(token, fullTtlSeconds)`:
1. `GET session:<token>` — retrieve session data
2. `TTL session:<token>` — check remaining TTL
3. If remaining TTL < 85% of `fullTtlSeconds` (i.e., >15% consumed, ~1 day): `EXPIRE session:<token> <fullTtlSeconds>` + also refresh the `user-sessions:<userId>` set TTL

`session-service.js` `validate()` calls `getAndRefresh` instead of plain `get`, passing the configured `sessionTtlHours * 3600`.

Revocation still works (delete key = instant logout).

### 1.4 Graceful Shutdown

**New:** `SIGTERM`/`SIGINT` handler in `src/index.js`:
1. Stop accepting new connections (`server.stop()`)
2. Close RabbitMQ connection (`rabbitConn.close()`)
3. Close Redis connection (`redis.close()`)
4. Close Postgres connection (`db.$client.close()` — Bun.sql underlying handle)
5. Exit 0

**Scoping fix:** `db`, `redis`, and `rabbitConn` are currently declared inside the `if (!overrides.userRepository)` block. Hoist their declarations to the outer `createApp` scope. Return them from `createApp` in a `connections` object alongside `app` and `port` so the shutdown handler (and tests) can access them.

### 1.5 RabbitMQ Connection Manager

**Current:** Single `amqplib.connect()` call, no recovery. Channel death = silent event loss.

**New:** `src/infrastructure/rabbitmq/connection-manager.js` — wraps connection lifecycle:
- Listens for `close`/`error` on connection and channel
- Reconnects with exponential backoff (1s, 2s, 4s, 8s, max 30s)
- Re-creates channel on reconnect
- Each `RabbitMQPublisher` calls its own `init()` (which `assertExchange`) on first publish — this already handles re-assertion because `ready` is reset when the channel is replaced
- Exposes `getChannel()`, `close()`, `isConnected()`
- Publishers receive the connection manager instead of a raw channel. They call `manager.getChannel()` on each publish. If `null`, publish returns `false`.

**Re-assertion strategy:** Publishers already have lazy `init()` that asserts their exchange on first `publish()`. On reconnect, the connection manager notifies publishers by resetting their `ready` flag. Next `publish()` calls `init()` again, re-asserting the exchange on the new channel. Both `auth.events` (topic) and `email.commands` (direct) exchanges are handled independently.

### 1.6 Atomic Redis Session Deletion

**Current:** `deleteAllForUser` loops over tokens with individual `DEL` calls — crash mid-loop leaves orphans.

**New:** Use Redis pipeline for all deletes + set removal in a single round-trip.

---

## Section 2: Security

### 2.1 OAuth State Verification

**Current:** `crypto.randomUUID()` generated but never stored or verified — CSRF vulnerability.

**New:** Store `oauth-state:<state>` in Redis with 5-min TTL. On callback, verify state matches using `crypto.timingSafeEqual` (constant-time comparison to prevent timing attacks) and delete it. Reject if missing/expired.

### 2.2 OAuth Authorization Code Exchange

**Current:** Session token passed as `?oauth_token=...` in redirect URL — leaks via browser history, logs, Referer header.

**New:** Short-lived authorization code pattern:
1. After OAuth callback, generate a one-time code (`crypto.randomBytes(32).toString('base64url')`), store in Redis as `oauth-code:<code>` with 30s TTL mapping to the full session data
2. Redirect to `${CLIENT_URL}?code=<one-time-code>`
3. Client exchanges code via `POST /auth/oauth/exchange` -> returns session token in response body
4. Code is deleted after first use (single-use)

New route file: `src/infrastructure/http/routes/oauth-exchange-route.js`. Add an `oauthCodeStore` (simple get/set/del wrapper on Redis with `oauth-code:` prefix) to the deps object.

### 2.3 Security Headers

**New:** Elysia `onBeforeHandle` hook:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-XSS-Protection: 0` (deprecated, but signals intent)
- `Referrer-Policy: strict-origin-when-cross-origin`

Note: these headers will also apply to 302 redirect responses from OAuth routes — this is harmless.

### 2.4 Global Error Handler

**New:** Elysia `onError` hook. Logs full error (message + stack) at error level, returns `{ error: 'Internal server error' }` with 500 to client. No stack traces or internal details leaked.

### 2.5 Request Body Validation

**Current:** Manual `if (!email || !password)` checks. No type/format/length validation.

**New:** Elysia `t.Object()` TypeBox schemas on all routes:
- Email: `t.String({ format: 'email' })`
- Password: `t.String({ minLength: 8, maxLength: 128 })`
- Display name: `t.String({ pattern: '^[a-z0-9_]{5,32}$' })`
- OTP code: `t.String({ minLength: 6, maxLength: 6 })`

**Note on `display-name.js`:** Keep the domain-level `validateDisplayName` as defense in depth. TypeBox validates at the HTTP boundary; the domain validator protects against direct service calls.

### 2.6 Bearer Token Parsing

**Current:** `headers.authorization?.replace('Bearer ', '')` — doesn't verify prefix.

**New:** Extract to `src/shared/utils.js` as `extractBearerToken(header)`. Uses `startsWith('Bearer ')` check, then `slice(7)`. Returns `null` if prefix doesn't match.

### 2.7 Password Strength

Minimum 8 characters. Enforced via TypeBox schema `minLength: 8` on register and password reset routes. No complexity rules per NIST SP 800-63B.

### 2.8 Request Body Size Limit

**New:** Set `maxRequestBodySize: 65536` via Bun.serve options passed through `app.listen()`. 64KB is generous for auth payloads.

### 2.9 Constant-Time Comparison for Service Key

**Current:** `validate-routes.js` compares `SERVICE_KEY` with `!==` — timing-vulnerable.

**New:** Use `crypto.timingSafeEqual` for the service key comparison. Extract to `src/shared/utils.js` as `secureCompare(a, b)`.

### 2.10 Remove Apple OAuth

Delete:
- `/auth/apple` and `/auth/apple/callback` routes from `oauth-routes.js`
- `apple` config block from `config.js`
- `APPLE_*` env vars from `.env.example`
- Keep `'apple'` in the `providerEnum` in `schema.js` (already migrated in Postgres, removing it requires a new migration — harmless to keep)

### 2.11 Make CLIENT_URL Required

Add `CLIENT_URL` to the required env vars list. In production, a missing/wrong `CLIENT_URL` means OAuth authorization codes get sent to the wrong origin — a security issue. Remove the default value.

---

## Section 3: Observability

### 3.1 Access Logging Middleware

**New:** Elysia lifecycle hooks for request logging:
```json
{"time":"...","level":"info","service":"auth-service","msg":"request","method":"POST","path":"/auth/login","status":200,"duration":42,"requestId":"uuid"}
```

- Skip `/health` endpoint to avoid log noise (health checks fire every 10 seconds)
- Never log request bodies for auth routes (passwords, tokens)

### 3.2 Request ID / Correlation ID

**New:** Generate `crypto.randomUUID()` per request. Set as `X-Request-ID` response header. If incoming request has `X-Request-ID` header, use that instead (cross-service tracing).

Use Elysia's `derive` to create a per-request context with `requestId`. The logger in route handlers receives the request ID from this context.

---

## Section 4: Deployment

### 4.1 Dockerfile

Updated:
```dockerfile
FROM oven/bun:1 AS install
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=install /app/node_modules ./node_modules
COPY . .
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1
CMD ["sh", "-c", "bun run db:migrate && bun run start"]
```

Changes from current: `curl` installed, `HEALTHCHECK` added. Interval set to **10s** (reduces probe load with multiple replicas).

### 4.2 docker-compose.yml (Local Dev Only)

Add:
- `ports: ["3001:3001"]` for app
- `environment` referencing `.env` file
- RabbitMQ service (`rabbitmq:3-management-alpine`) with healthcheck and management UI port
- App depends on all 3 services being healthy

### 4.3 .env.example

Update with all current env vars including `CLIENT_URL` (now required).

### 4.4 .dockerignore

Review and ensure it excludes: `node_modules/`, `.env`, `.git/`, `test/`, `docs/`, `*.md`, `.github/`.

---

## Section 5: Developer Experience

### 5.1 Package.json Scripts

- `dev` — `bun run scripts/dev.js` (port-finding wrapper)
- `start` — `bun run src/index.js`
- `test` — `bun test`
- `lint` — `eslint src/ test/`
- `lint:fix` — `eslint src/ test/ --fix`
- `format` — `prettier --write "src/**/*.js" "test/**/*.js"`
- `format:check` — `prettier --check "src/**/*.js" "test/**/*.js"`
- `check` — `bun run lint && bun run format:check && bun run test`
- `db:generate` — existing
- `db:migrate` — existing

### 5.2 Dev Script Port Finding

`scripts/dev.js` — tries `PORT` env or 3001, increments until a free port is found, then spawns `bun run --watch src/index.js` with the found port as `PORT` env var.

### 5.3 ESLint

`eslint.config.js` — flat config, JS-only:
- `@eslint/js` recommended rules
- Globals for node/bun
- Ignore `node_modules/`, `drizzle/`

### 5.4 Prettier

`.prettierrc`:
- Single quotes (matching current code style)
- No semicolons (matching current code style)
- Trailing commas: `all`
- Print width: 120
- Tab width: 2

### 5.5 Husky + lint-staged

- `.husky/pre-commit` — runs `bunx lint-staged`
- `.lintstagedrc` — runs `prettier --write` and `eslint --fix` on staged `.js` files

### 5.6 GitHub Actions CI

`.github/workflows/ci.yml`:
- Triggers: push to `main`, all PRs
- Runs on: `ubuntu-latest`
- Steps: checkout, setup Bun, install deps, lint, format check, run unit tests
- The e2e test (`test/e2e/auth-flow.test.js`) uses in-memory fakes, so it runs in CI without real infra

---

## Section 6: Code Cleanup

- Extract `maskEmail` to `src/shared/utils.js`, import in `auth-routes.js`, `otp-routes.js`, `otp-service.js`
- Extract `extractBearerToken` to `src/shared/utils.js`
- Extract `secureCompare` to `src/shared/utils.js`
- Delete `index.ts` (Bun scaffold leftover)
- Remove `event-consumer.js` (defined but never wired — add back when needed)

---

## Section 7: Documentation

### README.md
Project overview, tech stack, prerequisites, quick start, environment variables table, project structure, links to docs/.

### docs/architecture.md
Layered architecture, DI approach, module responsibilities, data flow diagrams (text) for: registration, login, OAuth, OTP, session validation.

### docs/api-reference.md
Every endpoint: method, path, auth, request body, response shape, error codes, rate limits.

### docs/deployment.md
Coolify setup (Dockerfile build pack, Postgres/Redis as separate resources, rolling updates, env vars, predefined network), local docker-compose usage, migration strategy, monitoring.

### docs/decisions.md
ADRs: opaque tokens vs JWT, Argon2id, Redis sessions, shared Postgres/separate DBs, separate Redis for auth, Redis rate limiting, no Apple OAuth, NIST password policy, sliding sessions, authorization code for OAuth redirects.

---

## Files Changed

**Modified:**
- `src/index.js` — graceful shutdown, hoist connection refs, pass db/redis to health, wire new rate limiters, connection manager, security headers, access logging, request ID, error handler, body size limit
- `src/config.js` — remove Apple config, make CLIENT_URL required
- `src/infrastructure/http/routes/health-routes.js` — deep health check with timeout
- `src/infrastructure/http/routes/auth-routes.js` — TypeBox schemas, use shared utils, dual login limiters
- `src/infrastructure/http/routes/validate-routes.js` — TypeBox schema, shared bearer extraction, constant-time service key comparison
- `src/infrastructure/http/routes/otp-routes.js` — TypeBox schemas, separate request/verify limiters, shared utils
- `src/infrastructure/http/routes/oauth-routes.js` — remove Apple, add state verification, authorization code redirect
- `src/infrastructure/redis/redis-session-store.js` — pipeline for batch delete, getAndRefresh for sliding sessions
- `src/modules/session/session-service.js` — use getAndRefresh in validate, pass fullTtlSeconds
- `src/infrastructure/rabbitmq/event-publisher.js` — use connection manager instead of raw channel
- `Dockerfile` — curl + HEALTHCHECK (10s interval)
- `docker-compose.yml` — add ports, env, rabbitmq service
- `package.json` — new scripts, new devDependencies
- `.gitignore` — ensure .env covered
- `.env.example` — updated, CLIENT_URL now required
- `.dockerignore` — exclude test/, docs/, .github/

**New:**
- `src/infrastructure/redis/redis-rate-limiter.js`
- `src/infrastructure/rabbitmq/connection-manager.js`
- `src/shared/utils.js` (maskEmail, extractBearerToken, secureCompare)
- `src/infrastructure/http/routes/oauth-exchange-route.js` (POST /auth/oauth/exchange)
- `scripts/dev.js`
- `eslint.config.js`
- `.prettierrc`
- `.husky/pre-commit`
- `.lintstagedrc`
- `.github/workflows/ci.yml`
- `README.md`
- `docs/architecture.md`
- `docs/api-reference.md`
- `docs/deployment.md`
- `docs/decisions.md`

**Deleted:**
- `index.ts`
- `src/infrastructure/rabbitmq/event-consumer.js`
