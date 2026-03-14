import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { loadConfig } from './config.js'
import { createContainer } from './container.js'
import { UserService } from './modules/identity/user-service.js'
import { SessionService } from './modules/session/session-service.js'
import { PasswordService } from './modules/credentials/password-service.js'
import { OtpService } from './modules/credentials/otp-service.js'
import { OAuthService } from './modules/oauth/oauth-service.js'
import { authRoutes } from './infrastructure/http/routes/auth-routes.js'
import { validateRoutes } from './infrastructure/http/routes/validate-routes.js'
import { otpRoutes } from './infrastructure/http/routes/otp-routes.js'
import { oauthRoutes } from './infrastructure/http/routes/oauth-routes.js'
import { healthRoutes } from './infrastructure/http/routes/health-routes.js'

const createApp = async ({ overrides = {}, config: configOverride } = {}) => {
  const config = configOverride || loadConfig(process.env)
  const container = createContainer({ overrides })

  if (!overrides.userRepository) {
    const { default: postgres } = await import('postgres')
    const { drizzle } = await import('drizzle-orm/postgres-js')
    const { default: Redis } = await import('ioredis')
    const amqplib = await import('amqplib')
    const { DrizzleUserRepository } = await import('./infrastructure/db/drizzle-user-repository.js')
    const { RedisSessionStore } = await import('./infrastructure/redis/redis-session-store.js')
    const { RedisOtpStore } = await import('./infrastructure/redis/redis-otp-store.js')
    const { RabbitMQPublisher } = await import('./infrastructure/rabbitmq/event-publisher.js')

    const client = postgres(config.database.url)
    const db = drizzle(client)
    const redis = new Redis(config.redis.url)
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
      userRepository: c.resolve('userRepository'),
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

  const deps = {
    userService: container.resolve('userService'),
    sessionService: container.resolve('sessionService'),
    passwordService: container.resolve('passwordService'),
    otpService: container.resolve('otpService'),
    oauthService: container.resolve('oauthService'),
    userRepository: container.resolve('userRepository'),
    serviceKey: config.serviceKey
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
