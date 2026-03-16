# API Reference

Base URL: `http://localhost:3001` (configurable via `PORT` env var).

All endpoints return JSON. All request bodies are validated with TypeBox schemas; invalid requests receive a 422 response with validation details.

Security headers are set on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `Referrer-Policy: strict-origin-when-cross-origin`.

Maximum request body size: 64 KB.

---

## GET /health

Deep health check. Probes Postgres (`SELECT 1`) and Redis (`PING`) with a 3-second timeout per check.

**Auth:** None

**Response (200 — healthy):**

```json
{
  "status": "ok",
  "service": "auth-service",
  "uptime": 42,
  "checks": {
    "database": "ok",
    "redis": "ok"
  }
}
```

**Response (503 — degraded):**

```json
{
  "status": "degraded",
  "service": "auth-service",
  "uptime": 42,
  "checks": {
    "database": "failing",
    "redis": "ok"
  }
}
```

Check values: `"ok"`, `"failing"`, `"skipped"` (if adapter not initialized, e.g., in tests).

---

## POST /auth/register

Create a new user account. Sends a verification OTP to the provided email.

**Auth:** None

**Rate limit:** `register` — 10 requests per 60 min per IP

**Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `email` | string | Yes | Valid email format |
| `password` | string | Yes | 8-128 characters |
| `displayName` | string | No | Lowercase alphanumeric + underscore, 5-32 chars (`^[a-z0-9_]{5,32}$`) |

**Response (200 — success or silent no-op for existing verified user):**

```json
{ "needsVerification": true }
```

**Response (409 — conflict):**

```json
{ "error": "Email already registered" }
```

**Response (429 — rate limited):**

```json
{ "error": "Too many attempts, try again later" }
```

Headers: `Retry-After: <seconds>`

**Behavior notes:**
- If the email belongs to a verified user, the endpoint returns the same success response without revealing account existence (silent no-op).
- If the email belongs to an unverified user, the password is updated and a new OTP is sent.

---

## POST /auth/register/verify

Verify email with the OTP code received during registration. On success, creates a session.

**Auth:** None

**Rate limit:** `otp-verify` — 10 requests per 15 min per email

**Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `email` | string | Yes | Valid email format |
| `code` | string | Yes | Exactly 6 characters |

**Response (200 — verified):**

```json
{
  "token": "opaque-session-token",
  "userId": "uuid",
  "expiresAt": "2026-03-23T12:00:00.000Z",
  "displayName": "john_doe",
  "needsDisplayName": true
}
```

`needsDisplayName` is present and `true` only if the user has no display name set.

**Response (401 — invalid code):**

```json
{ "error": "Invalid or expired code" }
```

**Response (400 — already verified):**

```json
{ "error": "Already verified" }
```

**Response (404 — user not found):**

```json
{ "error": "User not found" }
```

**Response (429 — rate limited):**

```json
{ "error": "Too many attempts, try again later" }
```

---

## POST /auth/login

Authenticate with email and password. Returns a session token.

**Auth:** None

**Rate limit:** `login-ip` — 30 requests per 15 min per IP, AND `login` — 10 requests per 15 min per email. IP is checked first. If either limit is exceeded, the request is rejected.

**Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `email` | string | Yes | Valid email format |
| `password` | string | Yes | 8-128 characters |

**Response (200 — success):**

```json
{
  "token": "opaque-session-token",
  "userId": "uuid",
  "expiresAt": "2026-03-23T12:00:00.000Z",
  "displayName": "john_doe",
  "needsDisplayName": true
}
```

**Response (200 — OAuth user without password, OTP sent):**

```json
{ "useOtp": true, "otpSent": true }
```

This occurs when a user registered via OAuth tries to log in with a password for the first time. The password is stored as pending, and an OTP is sent. After OTP verification, the password auth method is created.

**Response (401 — invalid credentials):**

```json
{ "error": "Invalid credentials" }
```

**Response (403 — email not verified):**

```json
{ "error": "Email not verified", "needsVerification": true }
```

**Response (429 — rate limited):**

```json
{ "error": "Too many attempts, try again later" }
```

**Behavior notes:**
- Single-session enforcement: creating a new session revokes all existing sessions for the user.

---

## GET /auth/me

Return the current user's session data. Extends the session TTL if >15% of the TTL has elapsed (sliding session).

**Auth:** `Authorization: Bearer <token>`

**Request body:** None

**Response (200 — valid session):**

```json
{
  "valid": true,
  "userId": "uuid",
  "email": "user@example.com",
  "displayName": "john_doe",
  "needsDisplayName": true
}
```

**Response (401 — no token or invalid session):**

```json
{ "error": "No token" }
```

```json
{ "error": "Invalid session" }
```

---

## POST /auth/logout

Revoke the current session.

**Auth:** `Authorization: Bearer <token>`

**Request body:** None

**Response (200 — success):**

```json
{ "ok": true }
```

**Response (401 — no token):**

```json
{ "error": "No token" }
```

---

## POST /auth/password/reset

Initiate a password reset. Hashes the new password, stores it as pending, and sends an OTP to the user's email. The password is only applied after OTP verification via `POST /auth/otp/verify`.

**Auth:** None

**Rate limit:** `otp-request` — 10 requests per 15 min per email

**Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `email` | string | Yes | Valid email format |
| `newPassword` | string | Yes | 8-128 characters |

**Response (200 — always, to prevent email enumeration):**

```json
{ "otpSent": true }
```

**Response (429 — rate limited):**

```json
{ "error": "Too many attempts, try again later" }
```

**Behavior notes:**
- If the email does not exist or is unverified, the response is identical to the success case. This prevents email enumeration.

---

## POST /auth/profile/display-name

Set or update the display name for the authenticated user.

**Auth:** `Authorization: Bearer <token>`

**Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `displayName` | string | Yes | Lowercase alphanumeric + underscore, 5-32 chars (`^[a-z0-9_]{5,32}$`) |

**Response (200 — success):**

```json
{ "displayName": "john_doe" }
```

**Response (400 — invalid format):**

```json
{ "error": "Invalid display name" }
```

**Response (401 — no token or invalid session):**

```json
{ "error": "No token" }
```

```json
{ "error": "Invalid session" }
```

**Response (409 — taken):**

```json
{ "error": "Display name already taken" }
```

---

## POST /auth/validate

Internal endpoint for service-to-service session validation. Authenticated with a shared service key, not a user session.

**Auth:** `X-Service-Key: <SERVICE_KEY>` header (compared with constant-time `timingSafeEqual`)

**Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `token` | string | Yes | The session token to validate |

**Response (200 — valid session):**

```json
{
  "valid": true,
  "userId": "uuid",
  "email": "user@example.com",
  "displayName": "john_doe"
}
```

**Response (200 — invalid or missing token):**

```json
{ "valid": false }
```

**Response (403 — invalid service key):**

```json
{ "error": "Invalid service key" }
```

---

## POST /auth/otp/request

Request a one-time password to be sent to the given email address.

**Auth:** None

**Rate limit:** `otp-request` — 10 requests per 15 min per email

**Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `email` | string | Yes | Valid email format |

**Response (200 — success):**

```json
{ "ok": true }
```

**Response (429 — rate limited or OTP service error):**

```json
{ "error": "Too many attempts, try again later" }
```

---

## POST /auth/otp/verify

Verify a one-time password. On success, creates or finds the user, verifies email if needed, creates a session. If a pending password exists (from login or password reset), the password auth method is created.

**Auth:** None

**Rate limit:** `otp-verify` — 10 requests per 15 min per email

**Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `email` | string | Yes | Valid email format |
| `code` | string | Yes | Exactly 6 characters |

**Response (200 — success):**

```json
{
  "token": "opaque-session-token",
  "userId": "uuid",
  "expiresAt": "2026-03-23T12:00:00.000Z",
  "displayName": "john_doe",
  "needsDisplayName": true
}
```

**Response (401 — invalid code):**

```json
{ "error": "Invalid or expired code" }
```

**Response (429 — rate limited):**

```json
{ "error": "Too many attempts, try again later" }
```

---

## GET /auth/google

Initiate Google OAuth flow. Generates a state parameter, stores it in Redis with 5-minute TTL, and redirects the user to Google's authorization endpoint.

**Auth:** None

**Response:** 302 redirect to Google OAuth consent page.

**Prerequisite:** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` must be configured.

---

## GET /auth/google/callback

Google OAuth callback. Verifies the state parameter, exchanges the authorization code for user info, creates/links the user, and generates a short-lived authorization code.

**Auth:** None (called by Google's redirect)

**Query parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `code` | Yes | Authorization code from Google |
| `state` | Yes | State parameter for CSRF protection |

**Response:** 302 redirect to `CLIENT_URL?code=<authorization-code>`.

On error: 302 redirect to `CLIENT_URL?oauth_error=<message>`.

**Error conditions:**
- Missing `code` parameter: 400 plain text response.
- Missing or invalid/expired `state`: redirect with `oauth_error`.
- Google token exchange failure: redirect with `oauth_error`.

---

## POST /auth/oauth/exchange

Exchange a short-lived OAuth authorization code for a session token. The code is single-use and expires after 30 seconds.

**Auth:** None

**Request body:**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `code` | string | Yes | Exactly 36 characters (UUID) |

**Response (200 — success):**

```json
{
  "token": "opaque-session-token",
  "userId": "uuid",
  "expiresAt": "2026-03-23T12:00:00.000Z",
  "displayName": "john_doe"
}
```

**Response (401 — invalid or expired code):**

```json
{ "error": "Invalid or expired code" }
```

---

## Rate Limit Summary

| Limiter | Key | Max Attempts | Window | Applied To |
|---------|-----|-------------|--------|------------|
| `register` | Client IP | 10 | 60 min | `POST /auth/register` |
| `login` | Email | 10 | 15 min | `POST /auth/login` |
| `login-ip` | Client IP | 30 | 15 min | `POST /auth/login` |
| `otp-request` | Email | 10 | 15 min | `POST /auth/otp/request`, `POST /auth/password/reset` |
| `otp-verify` | Email | 10 | 15 min | `POST /auth/otp/verify`, `POST /auth/register/verify` |

Rate-limited responses include a `Retry-After` header with the number of seconds until the limit resets.

## Common Error Responses

**422 — Validation Error** (TypeBox schema mismatch):

```json
{
  "type": "validation",
  "on": "body",
  "summary": "Expected string",
  "property": "/email",
  "message": "..."
}
```

**500 — Internal Server Error** (unhandled exception):

```json
{ "error": "Internal server error" }
```

No stack traces or internal details are exposed to clients.
