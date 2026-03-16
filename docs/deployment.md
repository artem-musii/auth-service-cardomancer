# Deployment

## Production: Coolify

The auth-service is deployed on [Coolify](https://coolify.io) using the **Dockerfile build pack** (not docker-compose). Each infrastructure dependency (Postgres, Redis, RabbitMQ) runs as a separate Coolify resource.

### Build Pack Configuration

Use **Dockerfile** as the build pack. Coolify builds the image from the project's `Dockerfile`, which includes:

- Multi-stage build: dependency installation is cached in a separate stage
- `curl` installed for the health check
- `HEALTHCHECK` directive for Coolify's rolling update detection
- `CMD` runs migrations then starts the server: `bun run db:migrate && bun run start`

### Infrastructure Resources

Deploy each as a separate Coolify resource (not bundled with the app):

**PostgreSQL:**
- Use Coolify's built-in Postgres resource
- Create a dedicated database named `auth_db`
- Strategy: shared Postgres cluster, separate databases per service (`auth_db`, `email_db`, etc.)
- Set `DATABASE_URL` in the auth-service environment variables

**Redis:**
- Use Coolify's built-in Redis resource
- Dedicated Redis instance for auth-service (not shared with other services)
- Sessions are security-critical; a shared Redis could allow other services to read/invalidate sessions
- Set `REDIS_URL` in the auth-service environment variables

**RabbitMQ:**
- Deploy as a Docker container in Coolify (use `rabbitmq:3-management-alpine` image)
- Set `RABBITMQ_URL` in the auth-service environment variables

### Networking

- Use Coolify's **predefined network** for inter-service communication
- All resources on the same predefined network can reach each other by container name
- **Do NOT map host ports** for production services — let Traefik handle external routing
- **Do NOT set custom container names** — Coolify manages naming for rolling updates

### Rolling Updates

Coolify performs rolling updates when a new deployment is triggered:

1. Coolify builds a new container image
2. The new container starts and must pass the `HEALTHCHECK` before receiving traffic
3. The old container is stopped after the new one is healthy

The `HEALTHCHECK` in the Dockerfile probes `GET /health` every 10 seconds. The health endpoint checks both Postgres and Redis connectivity with a 3-second timeout per probe.

**Known issue:** There is a brief window (a few seconds) during rolling updates where requests may receive 502 or 503 responses. This is inherent to Coolify's rolling update mechanism and is acceptable for an auth service where clients retry on failure.

### Environment Variables

Configure these in Coolify's environment variable UI for the auth-service resource:

```
DATABASE_URL=postgres://user:pass@postgres-resource:5432/auth_db
REDIS_URL=redis://redis-resource:6379
RABBITMQ_URL=amqp://rabbitmq-resource:5672
SERVICE_KEY=<generate-a-strong-random-string>
ALLOWED_ORIGINS=https://app.example.com
CLIENT_URL=https://app.example.com
SESSION_TTL_HOURS=168
GOOGLE_CLIENT_ID=<from-google-console>
GOOGLE_CLIENT_SECRET=<from-google-console>
GOOGLE_REDIRECT_URI=https://auth.example.com/auth/google/callback
PORT=3001
LOG_LEVEL=info
```

Replace hostnames with Coolify resource names on the predefined network.

`CLIENT_URL` is required. In production, a missing or incorrect `CLIENT_URL` sends OAuth authorization codes to the wrong origin — a security issue.

---

## Database Strategy

### Shared Cluster, Separate Databases

All microservices connect to the same Postgres cluster but use separate databases:

```
Postgres Cluster
  ├── auth_db      (auth-service)
  ├── email_db     (email-service)
  └── ...
```

This reduces operational overhead (one cluster to monitor, backup, scale) while maintaining data isolation between services. Each service owns its database exclusively; cross-service data access happens through APIs or events, never direct database queries.

### Migrations

Migrations run automatically on startup (`bun run db:migrate` in the Dockerfile `CMD`). This means:

- Every deployment runs pending migrations before the server accepts traffic
- Migrations must be **backward-compatible**: the previous version of the service may still be running during a rolling update
- Never rename or drop columns in a single deployment. Use a multi-step process: add new column, deploy, migrate data, deploy with new column usage, then drop old column

Migration files are generated with `bun run db:generate` (Drizzle Kit) and stored in the `drizzle/` directory.

---

## Redis Strategy

### Dedicated Instance

The auth-service uses a dedicated Redis instance, not shared with other services. Reasons:

- Sessions are security-critical data; isolating them prevents other services from accidentally or maliciously reading/invalidating sessions
- Auth-service rate limits and OTP codes have specific TTL requirements that could conflict with other services' eviction policies
- A dedicated instance allows tuning `maxmemory-policy` for session workloads (e.g., `volatile-ttl`)

### Data Stored in Redis

| Data | Key Pattern | TTL |
|------|-------------|-----|
| Sessions | `session:<token>` | 7 days (sliding) |
| User session index | `user-sessions:<userId>` | 7 days (sliding) |
| OTP codes | `otp:<email>` | 5 min |
| Pending passwords | `pending-pw:<email>` | 5 min |
| Rate limit counters | `rl:<limiter>:<key>` | 15-60 min |
| OAuth state | `oauth-state:<uuid>` | 5 min |
| OAuth auth codes | `oauth-code:<uuid>` | 30 sec |

All keys have explicit TTLs. No data persists indefinitely.

---

## Local Development

### Infrastructure

Start Postgres, Redis, and RabbitMQ with Docker Compose:

```bash
docker compose up -d
```

This starts:
- **Postgres 16** on port 5432 (user: `postgres`, password: `postgres`, database: `auth_db`)
- **Redis 7** on port 6379
- **RabbitMQ 3** on ports 5672 (AMQP) and 15672 (management UI)

All services include health checks. The app container is also defined in docker-compose but for local development you typically run the server directly:

```bash
cp .env.example .env    # first time only
bun run db:migrate      # first time or after schema changes
bun run dev             # starts with --watch and auto port finding
```

### Development Server

`bun run dev` executes `scripts/dev.js`, which:
1. Tries the configured `PORT` (default 3001)
2. If the port is in use, increments until a free port is found
3. Spawns `bun run --watch src/index.js` with the found port

This avoids port conflicts when running multiple services locally.

---

## Monitoring

### Health Check

`GET /health` returns 200 when both Postgres and Redis are reachable, 503 otherwise. The Dockerfile `HEALTHCHECK` polls this endpoint every 10 seconds.

### Structured Logging

All log output is structured JSON with fields: `time`, `level`, `service`, `msg`, and context-specific fields. Logs include:
- Request ID (`requestId`) for cross-service correlation
- Masked emails in all log entries (e.g., `joh***@example.com`)
- No request bodies logged (passwords, tokens)
- `/health` requests are excluded from access logs

### Events

Domain events published to RabbitMQ (`auth.events` exchange) can be consumed for monitoring:
- `user.created` — new user registered
- `user.deleted` — user soft-deleted
- `session.revoked` — session ended (logout, new login, or admin action)
