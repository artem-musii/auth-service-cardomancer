# auth-service

Authentication microservice providing user registration, login, session management, OTP verification, and OAuth integration.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | [Bun](https://bun.sh) v1+ |
| HTTP framework | [Elysia](https://elysiajs.com) |
| Database | PostgreSQL 16 via [Drizzle ORM](https://orm.drizzle.team) |
| Sessions & caching | Redis 7 |
| Message broker | RabbitMQ 3 |
| Password hashing | Argon2id (Bun built-in) |

## Prerequisites

- **Bun** v1.0 or later
- **Docker** and Docker Compose (for local infrastructure)

## Quick Start

```bash
# 1. Clone and install dependencies
git clone <repo-url> && cd auth-service
bun install

# 2. Start infrastructure (Postgres, Redis, RabbitMQ)
docker compose up -d

# 3. Copy and configure environment variables
cp .env.example .env
# Edit .env with your values

# 4. Run database migrations
bun run db:migrate

# 5. Start the development server
bun run dev
```

The dev server finds a free port starting from `PORT` (default 3001) and starts with `--watch` for live reload.

For production: `bun run start` runs the server directly on the configured port.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string (e.g., `postgres://user:pass@host:5432/auth_db`) |
| `REDIS_URL` | Yes | — | Redis connection string (e.g., `redis://host:6379`) |
| `RABBITMQ_URL` | Yes | — | RabbitMQ connection string (e.g., `amqp://host:5672`) |
| `SERVICE_KEY` | Yes | — | Shared secret for internal service-to-service `POST /auth/validate` calls |
| `ALLOWED_ORIGINS` | Yes | — | Comma-separated list of allowed CORS origins |
| `CLIENT_URL` | Yes | — | Frontend URL for OAuth redirects (e.g., `https://app.example.com`) |
| `SESSION_TTL_HOURS` | No | `168` (7 days) | Session duration in hours; sessions use sliding TTL |
| `GOOGLE_CLIENT_ID` | No | `""` | Google OAuth client ID; Google OAuth is disabled if empty |
| `GOOGLE_CLIENT_SECRET` | No | `""` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | No | `http://localhost:3001/auth/google/callback` | Google OAuth redirect URI |
| `PORT` | No | `3001` | HTTP listen port |
| `LOG_LEVEL` | No | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start dev server with watch mode and automatic port finding |
| `bun run start` | Start production server |
| `bun test` | Run test suite |
| `bun run lint` | Run ESLint |
| `bun run lint:fix` | Run ESLint with auto-fix |
| `bun run format` | Format code with Prettier |
| `bun run format:check` | Check formatting without writing |
| `bun run check` | Run lint + format check + tests |
| `bun run db:generate` | Generate Drizzle migration files |
| `bun run db:migrate` | Run pending database migrations |

## Project Structure

```
src/
  index.js                          # Application entry point, Elysia setup, graceful shutdown
  config.js                         # Environment variable loading and validation
  container.js                      # Manual DI container (register/resolve)
  logger.js                         # Structured JSON logger

  shared/
    utils.js                        # maskEmail, extractBearerToken, secureCompare

  modules/
    identity/
      user-entity.js                # User creation/normalization
      user-service.js               # User CRUD, email verification, display name
      display-name.js               # Display name validation rules
    session/
      session-entity.js             # Session token generation
      session-service.js            # Create, validate (sliding TTL), revoke sessions
    credentials/
      password-service.js           # Argon2id hash/verify
      otp-service.js                # OTP generation, verification, email dispatch
    oauth/
      oauth-service.js              # Provider-agnostic OAuth orchestration
    rate-limit/
      rate-limiter.js               # Rate limiter interface definition

  infrastructure/
    db/
      schema.js                     # Drizzle schema (users, auth_methods tables)
      drizzle-user-repository.js    # Postgres user repository implementation
    redis/
      redis-session-store.js        # Session storage with sliding TTL refresh
      redis-otp-store.js            # OTP code storage with expiry
      redis-rate-limiter.js         # Fixed window counter via Lua script
    rabbitmq/
      connection-manager.js         # Connection lifecycle, auto-reconnect
      event-publisher.js            # Publish to auth.events and email.commands exchanges
    oauth/
      google-provider.js            # Google OAuth token exchange
    http/routes/
      health-routes.js              # GET /health (deep check: Postgres + Redis)
      auth-routes.js                # Register, login, logout, password reset, profile
      validate-routes.js            # POST /auth/validate (internal, service-key auth)
      otp-routes.js                 # OTP request and verify
      oauth-routes.js               # GET /auth/google, callback
      oauth-exchange-route.js       # POST /auth/oauth/exchange
```

## Documentation

- [Architecture](docs/architecture.md) — layered design, DI, module responsibilities, data flow diagrams
- [API Reference](docs/api-reference.md) — all endpoints with request/response schemas
- [Deployment](docs/deployment.md) — Coolify, Docker, migrations, environment management
- [Decision Records](docs/decisions.md) — architectural decisions and rationale
