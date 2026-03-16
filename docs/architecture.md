# Architecture

## Layered Design

The auth-service follows a three-layer architecture with strict dependency direction: HTTP routes depend on domain services, which depend on infrastructure adapters. Infrastructure never imports from domain.

```
HTTP Routes (infrastructure/http/routes/)
    |
    v
Domain Services (modules/)
    |
    v
Infrastructure Adapters (infrastructure/db/, infrastructure/redis/, infrastructure/rabbitmq/)
```

### Layer Responsibilities

**HTTP Routes** — Parse requests, validate input with TypeBox schemas, apply rate limits, call domain services, format responses. No business logic lives here.

**Domain Services** — Implement business rules: user creation, session lifecycle, password hashing, OTP generation, OAuth orchestration. Services receive their dependencies via constructor injection.

**Infrastructure Adapters** — Concrete implementations for external systems: Drizzle/Postgres for persistence, Redis for sessions/OTP/rate limits, RabbitMQ for event publishing, Google API for OAuth.

## Dependency Injection

The service uses a manual DI container (`src/container.js`) with no framework. The container supports `register(name, factory)` and `resolve(name)` with lazy singleton semantics: each factory is called once on first resolve, and the result is cached.

```
container.register('userRepository', () => DrizzleUserRepository(db))
container.register('userService', (c) => UserService({
  userRepository: c.resolve('userRepository'),
  eventPublisher: c.resolve('eventPublisher'),
}))
```

For testing, the `createApp()` function accepts an `overrides` object. Any key present in overrides bypasses the container entirely, allowing in-memory fakes to replace real infrastructure without conditional logic in production code.

## Module Responsibilities

### identity/ — User Management

- **user-entity.js** — Normalizes email (lowercase, trimmed), validates format, produces a user creation payload.
- **user-service.js** — Creates users, looks up by email/ID, soft-deletes, verifies email, updates display names. Publishes `user.created` and `user.deleted` events.
- **display-name.js** — Validates display name format: lowercase alphanumeric and underscores, 5-32 characters. Used as defense-in-depth behind the TypeBox schema.

### session/ — Session Lifecycle

- **session-entity.js** — Generates opaque session tokens (`crypto.randomBytes`), computes expiry from configured TTL.
- **session-service.js** — Creates sessions (single-session enforcement: all existing sessions for the user are revoked first), validates with sliding TTL refresh, revokes individual or all sessions, updates display name in active sessions. Publishes `session.revoked` events.

### credentials/ — Password and OTP

- **password-service.js** — Wraps Bun's built-in Argon2id: `Bun.password.hash()` and `Bun.password.verify()`.
- **otp-service.js** — Generates 6-digit OTP codes, stores in Redis with 5-minute TTL, publishes email commands via RabbitMQ for delivery. Supports pending password storage for password-reset and password-on-login flows.

### oauth/ — OAuth Orchestration

- **oauth-service.js** — Provider-agnostic orchestration. Accepts a map of provider implementations, delegates `getAuthUrl()` and `exchangeCode()` to the appropriate provider. On callback: finds or creates user, links auth method, creates session.

### rate-limit/ — Rate Limiting

- **rate-limiter.js** — Defines the interface: `check(key) -> { allowed, remaining, retryAfterMs }`.
- Implemented by `RedisRateLimiter` (infrastructure layer) using a Lua script for atomic `INCR + EXPIRE`.

## Infrastructure Adapters

### PostgreSQL (Drizzle ORM)

- **schema.js** — Defines `users` and `auth_methods` tables. Users have email, display name, email verification timestamp, soft-delete timestamp. Auth methods link users to providers (password, google, apple) with provider-specific credentials.
- **drizzle-user-repository.js** — Implements the user repository interface: CRUD operations, auth method management, display name uniqueness checks.

### Redis

Three distinct uses, all sharing the same Redis connection:

| Use | Key Pattern | TTL |
|-----|-------------|-----|
| Sessions | `session:<token>` | 7 days (sliding) |
| User session index | `user-sessions:<userId>` (SET) | 7 days (sliding) |
| OTP codes | `otp:<email>` | 5 minutes |
| Pending passwords | `pending-pw:<email>` | 5 minutes |
| Rate limit counters | `rl:<limiter>:<key>` | Per-limiter window |
| OAuth state | `oauth-state:<uuid>` | 5 minutes |
| OAuth auth codes | `oauth-code:<uuid>` | 30 seconds |

### RabbitMQ

Two exchanges, both durable:

| Exchange | Type | Purpose |
|----------|------|---------|
| `auth.events` | topic | Domain events: `user.created`, `user.deleted`, `session.revoked` |
| `email.commands` | direct | Commands to email service: `otp.requested` |

The **connection manager** handles connection lifecycle with automatic reconnection (exponential backoff: 1s, 2s, 4s... max 30s). Publishers register with the manager and have their `ready` flag reset on reconnect, triggering exchange re-assertion on next publish.

## Data Flow Diagrams

### Registration

```
Client                   auth-routes           rate-limiter    user-service    otp-service    RabbitMQ
  |                          |                      |               |              |             |
  |-- POST /auth/register -->|                      |               |              |             |
  |                          |-- check(ip) -------->|               |              |             |
  |                          |<-- allowed ----------|               |              |             |
  |                          |-- createUser ------->|               |              |             |
  |                          |                      |               |-- publish --->|-- user.created -->
  |                          |-- hash password      |               |              |             |
  |                          |-- createAuthMethod ->|               |              |             |
  |                          |-- requestOtp ------->|-------------->|              |             |
  |                          |                      |               |-- publish -->|-- otp.requested ->
  |<-- { needsVerification } |                      |               |              |             |
```

### Email Verification (Register Verify)

```
Client                   auth-routes          rate-limiter    otp-service    user-service    session-service
  |                          |                     |              |              |                |
  |-- POST /register/verify->|                     |              |              |                |
  |                          |-- check(email) ---->|              |              |                |
  |                          |<-- allowed ---------|              |              |                |
  |                          |-- verifyOtp ------->|              |              |                |
  |                          |<-- { valid: true } -|              |              |                |
  |                          |-- verifyEmail ----->|------------->|              |                |
  |                          |-- createSession --->|------------->|------------->|                |
  |<-- { token, userId } ----|                     |              |              |                |
```

### Login

```
Client                   auth-routes          rate-limiter(ip)   rate-limiter(email)   user-service   session-service
  |                          |                      |                    |                  |               |
  |-- POST /auth/login ----->|                      |                    |                  |               |
  |                          |-- check(ip) -------->|                    |                  |               |
  |                          |<-- allowed ----------|                    |                  |               |
  |                          |-- check(email) ----->|------------------->|                  |               |
  |                          |<-- allowed ----------|--------------------|                  |               |
  |                          |-- findByEmail ------>|------------------->|----------------->|               |
  |                          |-- verify password    |                    |                  |               |
  |                          |-- createSession ---->|------------------->|----------------->|               |
  |<-- { token, userId } ----|                      |                    |                  |               |
```

### OTP Request and Verify

```
Client                   otp-routes           rate-limiter     otp-service     Redis          RabbitMQ
  |                          |                     |               |             |               |
  |-- POST /otp/request ---->|                     |               |             |               |
  |                          |-- check(email) ---->|               |             |               |
  |                          |<-- allowed ---------|               |             |               |
  |                          |-- requestOtp ------>|               |             |               |
  |                          |                     |-- SET otp:* ->|             |               |
  |                          |                     |-- publish --->|------------>|-- otp.requested -->
  |<-- { ok: true } ---------|                     |               |             |               |
  |                          |                     |               |             |               |
  |-- POST /otp/verify ----->|                     |               |             |               |
  |                          |-- check(email) ---->|               |             |               |
  |                          |-- verifyOtp ------->|               |             |               |
  |                          |                     |-- GET otp:* ->|             |               |
  |                          |                     |<-- code ------|             |               |
  |                          |<-- { valid } -------|               |             |               |
  |                          |-- createSession     |               |             |               |
  |<-- { token, userId } ----|                     |               |             |               |
```

### OAuth (Google)

```
Client                   Browser              oauth-routes         Redis          Google         oauth-exchange
  |                         |                      |                  |              |                |
  |-- click "Login" ------->|                      |                  |              |                |
  |                         |-- GET /auth/google ->|                  |              |                |
  |                         |                      |-- SET state ---->|              |                |
  |                         |<-- 302 to Google ----|                  |              |                |
  |                         |-- authorize -------->|----------------->|              |                |
  |                         |<-- 302 + code -------|------------------|              |                |
  |                         |-- GET /callback?code&state ----------->|              |                |
  |                         |                      |-- GET state ---->|              |                |
  |                         |                      |-- DEL state ---->|              |                |
  |                         |                      |-- exchangeCode ->|------------>|                |
  |                         |                      |<-- user info ----|              |                |
  |                         |                      |-- create session |              |                |
  |                         |                      |-- SET oauth-code>|              |                |
  |                         |<-- 302 ?code=<authCode> --------------|              |                |
  |<-- receive code --------|                      |                  |              |                |
  |-- POST /oauth/exchange ->|-------------------->|----------------->|              |                |
  |                         |                      |-- GET oauth-code>|              |                |
  |                         |                      |-- DEL oauth-code>|              |                |
  |<-- { token, userId } ---|                      |                  |              |                |
```

### Session Validation (Internal)

```
Other Service            validate-routes       session-service      Redis
  |                          |                       |                |
  |-- POST /auth/validate -->|                       |                |
  |   X-Service-Key: ***     |                       |                |
  |   { token: "..." }       |                       |                |
  |                          |-- secureCompare key   |                |
  |                          |-- validate(token) --->|                |
  |                          |                       |-- GET session ->|
  |                          |                       |-- check TTL -->|
  |                          |                       |-- EXPIRE? ---->| (sliding refresh)
  |                          |<-- { valid, userId } -|                |
  |<-- { valid, userId } ----|                       |                |
```

## Security Middleware

Applied globally via Elysia lifecycle hooks in `src/index.js`:

1. **Security headers** (`onBeforeHandle`) — Sets `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `X-XSS-Protection`, `Referrer-Policy` on every response.
2. **Request ID** (`derive`) — Generates `crypto.randomUUID()` per request, or reuses incoming `X-Request-ID` header for cross-service correlation.
3. **Access logging** (`onAfterHandle`) — Logs method, path, status, duration, and request ID for every request except `/health`.
4. **Global error handler** (`onError`) — Catches unhandled errors, logs full stack trace, returns generic 500 to client. Validation errors (TypeBox) are passed through to Elysia's default handler.
5. **Body size limit** — `maxRequestBodySize: 65536` (64 KB) set on the Bun HTTP server.
6. **CORS** — Configured via `@elysiajs/cors` with `ALLOWED_ORIGINS` from environment.
