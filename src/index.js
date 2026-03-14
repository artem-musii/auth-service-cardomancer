import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { loadConfig } from './config.js'
import { createContainer } from './container.js'
import { UserService } from './modules/identity/user-service.js'
import { SessionService } from './modules/session/session-service.js'
import { PasswordService } from './modules/credentials/password-service.js'
import { OtpService } from './modules/credentials/otp-service.js'
import { OAuthService } from './modules/oauth/oauth-service.js'
import { RateLimiter } from './modules/rate-limit/rate-limiter.js'
import { authRoutes } from './infrastructure/http/routes/auth-routes.js'
import { validateRoutes } from './infrastructure/http/routes/validate-routes.js'
import { otpRoutes } from './infrastructure/http/routes/otp-routes.js'
import { oauthRoutes } from './infrastructure/http/routes/oauth-routes.js'
import { healthRoutes } from './infrastructure/http/routes/health-routes.js'

const createApp = async ({ overrides = {}, config: configOverride } = {}) => {
  const config = configOverride || loadConfig(process.env)
  const container = createContainer({ overrides })

  if (!overrides.userRepository) {
    const { drizzle } = await import('drizzle-orm/bun-sql')
    const { RedisClient } = await import('bun')
    const amqplib = await import('amqplib')
    const { DrizzleUserRepository } = await import('./infrastructure/db/drizzle-user-repository.js')
    const { RedisSessionStore } = await import('./infrastructure/redis/redis-session-store.js')
    const { RedisOtpStore } = await import('./infrastructure/redis/redis-otp-store.js')
    const { RabbitMQPublisher } = await import('./infrastructure/rabbitmq/event-publisher.js')

    const db = drizzle(config.database.url)
    const redis = new RedisClient(config.redis.url)
    const rabbitConn = await amqplib.connect(config.rabbitmq.url)
    const rabbitChannel = await rabbitConn.createChannel()

    container.register('userRepository', () => DrizzleUserRepository(db))
    container.register('sessionStore', () => RedisSessionStore(redis))
    container.register('otpStore', () => RedisOtpStore(redis))
    container.register('eventPublisher', () => RabbitMQPublisher(rabbitChannel))
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
    overrides.otpService || OtpService({ otpStore: c.resolve('otpStore'), eventPublisher: c.resolve('eventPublisher') })
  )

  container.register('oauthService', (c) =>
    overrides.oauthService || OAuthService({
      userService: c.resolve('userService'),
      sessionService: c.resolve('sessionService'),
      userRepository: c.resolve('userRepository'),
      providers: {}
    })
  )

  const app = new Elysia()
    .use(cors({ origin: config.allowedOrigins }))

  const rateLimiters = {
    login: RateLimiter({ store: new Map(), maxAttempts: 5, windowMs: 15 * 60 * 1000 }),
    register: RateLimiter({ store: new Map(), maxAttempts: 5, windowMs: 60 * 60 * 1000 }),
    otp: RateLimiter({ store: new Map(), maxAttempts: 5, windowMs: 15 * 60 * 1000 }),
  }

  const deps = {
    userService: container.resolve('userService'),
    sessionService: container.resolve('sessionService'),
    passwordService: container.resolve('passwordService'),
    otpService: container.resolve('otpService'),
    oauthService: container.resolve('oauthService'),
    userRepository: container.resolve('userRepository'),
    serviceKey: config.serviceKey,
    rateLimiters
  }

  healthRoutes(app)
  authRoutes(app, deps)
  validateRoutes(app, deps)
  otpRoutes(app, deps)
  oauthRoutes(app, deps)

  const server = app.listen(config.port)
  const port = server.server.port

  return { app: server, port }
}

export { createApp }

if (import.meta.main) {
  createApp().then(({ port }) => console.log(`Auth service running on port ${port}`))
}
