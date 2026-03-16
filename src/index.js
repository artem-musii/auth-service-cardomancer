import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { loadConfig } from './config.js'
import { createLogger } from './logger.js'
import { createContainer } from './container.js'
import { UserService } from './modules/identity/user-service.js'
import { SessionService } from './modules/session/session-service.js'
import { PasswordService } from './modules/credentials/password-service.js'
import { OtpService } from './modules/credentials/otp-service.js'
import { OAuthService } from './modules/oauth/oauth-service.js'
import { GoogleProvider } from './infrastructure/oauth/google-provider.js'
import { RedisRateLimiter } from './infrastructure/redis/redis-rate-limiter.js'
import { RabbitMQConnectionManager } from './infrastructure/rabbitmq/connection-manager.js'
import { authRoutes } from './infrastructure/http/routes/auth-routes.js'
import { validateRoutes } from './infrastructure/http/routes/validate-routes.js'
import { otpRoutes } from './infrastructure/http/routes/otp-routes.js'
import { oauthRoutes } from './infrastructure/http/routes/oauth-routes.js'
import { oauthExchangeRoute } from './infrastructure/http/routes/oauth-exchange-route.js'
import { healthRoutes } from './infrastructure/http/routes/health-routes.js'

const createApp = async ({ overrides = {}, config: configOverride } = {}) => {
  const config = configOverride || loadConfig(process.env)
  const log = createLogger('auth-service', config.logLevel)
  const container = createContainer({ overrides })

  let db = null
  let redis = null
  let rabbitManager = null

  if (!overrides.userRepository) {
    const { drizzle } = await import('drizzle-orm/bun-sql')
    const { RedisClient } = await import('bun')
    const { DrizzleUserRepository } = await import('./infrastructure/db/drizzle-user-repository.js')
    const { RedisSessionStore } = await import('./infrastructure/redis/redis-session-store.js')
    const { RedisOtpStore } = await import('./infrastructure/redis/redis-otp-store.js')
    const { RabbitMQPublisher } = await import('./infrastructure/rabbitmq/event-publisher.js')

    db = drizzle(config.database.url)
    log.info('database connected')
    redis = new RedisClient(config.redis.url)
    log.info('redis connected')
    rabbitManager = RabbitMQConnectionManager({ url: config.rabbitmq.url, log })
    await rabbitManager.connect()

    container.register('userRepository', () => DrizzleUserRepository(db))
    container.register('sessionStore', () => RedisSessionStore(redis))
    container.register('otpStore', () => RedisOtpStore(redis))
    container.register('eventPublisher', () => RabbitMQPublisher(rabbitManager, { log }))
    container.register('emailPublisher', () => RabbitMQPublisher(rabbitManager, { exchange: 'email.commands', type: 'direct', log }))
  }

  container.register('passwordService', () => overrides.passwordService || PasswordService())

  container.register('userService', (c) =>
    overrides.userService || UserService({ userRepository: c.resolve('userRepository'), eventPublisher: c.resolve('eventPublisher') })
  )

  container.register('sessionService', (c) =>
    overrides.sessionService || SessionService({
      sessionStore: c.resolve('sessionStore'),
      eventPublisher: c.resolve('eventPublisher'),
      sessionTtlHours: config.session.ttlHours
    })
  )

  container.register('otpService', (c) =>
    overrides.otpService || OtpService({ otpStore: c.resolve('otpStore'), emailPublisher: c.resolve('emailPublisher'), log })
  )

  container.register('oauthService', (c) => {
    const providers = {}
    if (config.google.clientId) {
      providers.google = GoogleProvider({
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
        redirectUri: config.google.redirectUri
      })
    }
    return overrides.oauthService || OAuthService({
      userService: c.resolve('userService'),
      sessionService: c.resolve('sessionService'),
      userRepository: c.resolve('userRepository'),
      providers
    })
  })

  const rateLimiters = overrides.rateLimiters || {
    login: RedisRateLimiter({ redis, prefix: 'login', maxAttempts: 10, windowSeconds: 900 }),
    'login-ip': RedisRateLimiter({ redis, prefix: 'login-ip', maxAttempts: 30, windowSeconds: 900 }),
    register: RedisRateLimiter({ redis, prefix: 'register', maxAttempts: 10, windowSeconds: 3600 }),
    'otp-request': RedisRateLimiter({ redis, prefix: 'otp-request', maxAttempts: 10, windowSeconds: 900 }),
    'otp-verify': RedisRateLimiter({ redis, prefix: 'otp-verify', maxAttempts: 10, windowSeconds: 900 }),
  }

  const app = new Elysia()
    .use(cors({ origin: config.allowedOrigins }))
    .onBeforeHandle(({ set }) => {
      set.headers['X-Content-Type-Options'] = 'nosniff'
      set.headers['X-Frame-Options'] = 'DENY'
      set.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
      set.headers['X-XSS-Protection'] = '0'
      set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    })
    .derive(({ headers }) => ({
      requestId: headers['x-request-id'] || crypto.randomUUID(),
    }))
    .onAfterHandle(({ request, set, requestId }) => {
      const url = new URL(request.url)
      if (url.pathname === '/health') return
      log.info('request', {
        method: request.method,
        path: url.pathname,
        status: set.status || 200,
        requestId,
      })
      set.headers['X-Request-ID'] = requestId
    })
    .onError(({ code, error, set }) => {
      if (code === 'VALIDATION') return
      log.error('unhandled error', { error: error.message, stack: error.stack })
      set.status = 500
      return { error: 'Internal server error' }
    })

  const deps = {
    userService: container.resolve('userService'),
    sessionService: container.resolve('sessionService'),
    passwordService: container.resolve('passwordService'),
    otpService: container.resolve('otpService'),
    oauthService: container.resolve('oauthService'),
    userRepository: container.resolve('userRepository'),
    serviceKey: config.serviceKey,
    clientUrl: config.clientUrl,
    rateLimiters,
    redis,
    log,
  }

  healthRoutes(app, { db, redis })
  authRoutes(app, deps)
  validateRoutes(app, deps)
  otpRoutes(app, deps)
  oauthRoutes(app, deps)
  oauthExchangeRoute(app, deps)

  const server = app.listen({ port: config.port, maxRequestBodySize: 65536 })
  const port = server.server.port

  const shutdown = async () => {
    log.info('shutting down gracefully...')
    server.stop()
    if (rabbitManager) await rabbitManager.close()
    if (redis) await redis.close()
    if (db) await db.$client.close()
    log.info('shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  return { app: server, port, shutdown, connections: { db, redis, rabbitManager } }
}

export { createApp }

if (import.meta.main) {
  createApp().then(({ port }) => {
    const log = createLogger('auth-service', process.env.LOG_LEVEL || 'info')
    log.info('auth service started', { port })
  })
}
