# Architectural Decision Records

## ADR-1: Opaque Session Tokens Over JWT

**Status:** Accepted

**Context:** The service needs to issue authentication tokens to clients. JWTs are self-contained and can be validated without a network call, but they cannot be revoked until expiry. The auth-service requires instant session revocation (logout, single-session enforcement, compromised account lockout).

**Decision:** Use opaque session tokens (random bytes via `crypto.randomBytes`) stored in Redis. Every validation requires a Redis lookup.

**Consequences:**
- Instant revocation: deleting the Redis key immediately invalidates the session.
- Single-session enforcement is straightforward: revoke all existing sessions before creating a new one.
- Every request to a downstream service that calls `POST /auth/validate` incurs a Redis round-trip. At current scale, this adds <1ms per request on the same network.
- If Redis is unavailable, all sessions are effectively invalid. The deep health check (`GET /health`) detects this and returns 503, allowing load balancers to route traffic away.

---

## ADR-2: Argon2id for Password Hashing

**Status:** Accepted

**Context:** Passwords must be hashed with a memory-hard algorithm to resist GPU/ASIC brute-force attacks. Bun provides built-in `Bun.password.hash()` and `Bun.password.verify()` using Argon2id.

**Decision:** Use Bun's built-in Argon2id implementation with default parameters. No external library required.

**Consequences:**
- Argon2id is the current OWASP recommendation and winner of the Password Hashing Competition.
- Bun's implementation uses sensible defaults (memory cost, time cost, parallelism) that balance security and latency.
- No dependency on `bcrypt`, `argon2`, or any native module. The hashing is built into the runtime.
- Each hash operation takes ~100-200ms, which is intentional — it makes brute force impractical even if the hash database is leaked.

---

## ADR-3: Redis for Session Storage

**Status:** Accepted

**Context:** Sessions need fast read/write access, automatic expiry, and the ability to enumerate all sessions for a user (for single-session enforcement).

**Decision:** Store sessions in Redis with key pattern `session:<token>` and a secondary set `user-sessions:<userId>` indexing all tokens for a user.

**Consequences:**
- Sub-millisecond read/write for session validation (the hot path).
- Native TTL support via `EXPIRE` — sessions automatically disappear after the configured duration.
- The user-sessions set enables efficient "revoke all sessions" without scanning the keyspace.
- Sessions do not survive a Redis restart unless persistence (RDB/AOF) is configured. This is acceptable: users simply log in again.

---

## ADR-4: Shared Postgres Cluster, Separate Databases

**Status:** Accepted

**Context:** The platform has multiple microservices (auth, email, etc.) that each need a relational database. Options: one database per service with separate Postgres instances, or a shared Postgres cluster with separate databases.

**Decision:** Run a single Postgres cluster with separate databases per service (`auth_db`, `email_db`, etc.).

**Consequences:**
- Reduced operational overhead: one Postgres instance to provision, monitor, back up, and scale.
- Data isolation maintained at the database level: each service has its own schema, tables, and connection string.
- Cross-service queries are impossible by design (different databases), enforcing service boundaries.
- Risk: a runaway query in one service's database can affect the shared cluster's resources. Mitigation: use connection limits and statement timeouts per database.
- Scaling is simpler in early stages. If a service outgrows the shared cluster, it can be migrated to its own instance by changing `DATABASE_URL`.

---

## ADR-5: Dedicated Redis for Auth Service

**Status:** Accepted

**Context:** Redis is used for sessions, OTP codes, rate limit counters, and OAuth state. Other services (e.g., email-service) may also need Redis for caching or queues.

**Decision:** The auth-service gets its own Redis instance, not shared with other services.

**Consequences:**
- Session data is security-critical. Isolation prevents other services from accidentally reading, overwriting, or evicting session keys.
- Rate limit counters and OTP codes have specific TTL profiles that won't conflict with other services' usage patterns.
- Memory sizing and `maxmemory-policy` can be tuned specifically for the auth workload (all keys have explicit TTLs, so `volatile-ttl` is appropriate).
- Additional operational cost of running a separate Redis instance. This is minimal with managed Redis or container-based deployment.

---

## ADR-6: Redis-Backed Rate Limiting (Not In-Memory)

**Status:** Accepted

**Context:** The original rate limiter used an in-memory `Map`. This resets on every process restart and does not work with multiple replicas.

**Decision:** Replace with a Redis-backed fixed window counter using an atomic Lua script (`INCR` + `EXPIRE` in a single eval). Keys follow the pattern `rl:<limiter>:<key>`.

**Consequences:**
- Rate limits persist across restarts and are shared across all replicas.
- The Lua script is atomic: there is no race condition between incrementing the counter and setting the TTL. Without the Lua approach, a crash between `INCR` and `EXPIRE` would create a counter that never expires.
- Each rate limit check requires one Redis round-trip (`EVAL` + possible `TTL`), adding ~0.5ms per request.
- If Redis is unavailable, rate limit checks fail open (requests are allowed). This is a deliberate tradeoff: availability over strict enforcement. The health check will detect the Redis failure.

---

## ADR-7: No Apple OAuth (Deferred)

**Status:** Accepted

**Context:** Apple Sign In requires an Apple Developer account ($99/year), a Services ID, and a private key. The initial deployment targets web-only. Apple OAuth is primarily valuable for iOS apps.

**Decision:** Remove Apple OAuth routes and configuration. Keep `'apple'` in the Postgres `provider` enum (already migrated, removing it requires a new migration that adds no value).

**Consequences:**
- Simpler codebase and configuration. No dead code for an unconfigured provider.
- The `provider` enum in Postgres still includes `'apple'`, which is harmless and avoids an unnecessary migration.
- Apple OAuth can be added later by implementing an `AppleProvider` and registering it in `src/index.js`. The OAuth service is provider-agnostic — no changes needed outside the provider implementation and route registration.

---

## ADR-8: NIST SP 800-63B Password Policy (8+ Characters, No Complexity)

**Status:** Accepted

**Context:** Traditional password policies (uppercase, lowercase, number, special character) lead to predictable patterns (`Password1!`) and user frustration. NIST SP 800-63B (Digital Identity Guidelines) recommends a minimum length of 8 characters with no composition rules.

**Decision:** Enforce a minimum of 8 characters and maximum of 128 characters. No uppercase, lowercase, digit, or special character requirements. Enforced via TypeBox schema `t.String({ minLength: 8, maxLength: 128 })`.

**Consequences:**
- Users can choose passphrases (e.g., "correct horse battery staple") which are both more secure and more memorable than short complex passwords.
- Reduces password reset volume caused by users forgetting complex passwords.
- Security relies on password length + Argon2id hashing + rate limiting, not complexity theater.
- Future improvement: add a breached password check (Have I Been Pwned API) to reject known-compromised passwords.

---

## ADR-9: Sliding Sessions

**Status:** Accepted

**Context:** With a fixed 7-day TTL, active users get logged out exactly 7 days after login regardless of activity. This is disruptive for daily-active users.

**Decision:** Implement sliding sessions. On each validation, if more than 15% of the TTL has elapsed (~1 day for a 7-day session), the TTL is reset to the full duration. The refresh logic lives in the infrastructure layer (`redis-session-store.js`), not the domain layer.

**Consequences:**
- Active users remain logged in indefinitely (their session TTL keeps resetting).
- Inactive users are logged out after the full TTL (7 days by default).
- The 15% threshold prevents unnecessary Redis `EXPIRE` calls on every single request. For a 7-day session, the TTL is only refreshed after ~1 day of the session has elapsed.
- Session revocation still works instantly: deleting the Redis key makes the session invalid regardless of remaining TTL.

---

## ADR-10: OAuth Authorization Code Exchange Pattern

**Status:** Accepted

**Context:** After a successful OAuth callback, the server needs to deliver a session token to the client. The original implementation passed the token as a query parameter in the redirect URL (`?oauth_token=...`). This leaks the token via browser history, server logs, and the `Referer` header on subsequent navigation.

**Decision:** Use a short-lived authorization code pattern:
1. After OAuth callback, generate a one-time code, store it in Redis with a 30-second TTL mapping to the session data.
2. Redirect to `CLIENT_URL?code=<one-time-code>`.
3. Client exchanges the code via `POST /auth/oauth/exchange` to receive the session token in the response body.
4. The code is deleted after first use (single-use).

**Consequences:**
- The session token never appears in a URL. It is only transmitted in the POST response body.
- The authorization code is single-use and expires in 30 seconds, limiting the window for interception.
- Adds one extra HTTP round-trip for the client after OAuth redirect. This is negligible.
- The client must implement the exchange step. This is a standard OAuth pattern that frontend developers expect.

---

## ADR-11: Fixed Window Rate Limiting

**Status:** Accepted

**Context:** Rate limiting is needed to prevent brute-force login attempts, registration abuse, and OTP enumeration. Options include fixed window, sliding window, token bucket, and leaky bucket algorithms.

**Decision:** Use fixed window counters. Each limiter has a key pattern `rl:<limiter>:<key>`, a max attempt count, and a window duration. The counter increments on each request and the window expires after the configured duration.

**Consequences:**
- Simple to implement and reason about: N attempts per M minutes.
- Atomic via a Lua script (`INCR` + `EXPIRE`), no race conditions.
- Known limitation: at the boundary of two windows, a user could make up to 2x the limit in a short burst (e.g., 10 requests at the end of window 1 and 10 at the start of window 2). This is acceptable because Argon2id hashing makes brute force impractical regardless, and the rate limiter's purpose is abuse prevention, not cryptographic security.
- Sliding window would eliminate the boundary burst issue but requires more complex Redis operations (sorted sets or multiple keys). The added complexity is not justified at current scale.
- Progressive penalty (exponential backoff, account lockout) is not implemented. The fixed window allows unlimited attempts over time (10 per 15 minutes indefinitely). This can be added later if monitoring reveals sustained attack patterns.
