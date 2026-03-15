import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { createApp } from '../../src/index.js'
import { InMemoryUserRepository } from '../fakes/in-memory-user-repository.js'
import { InMemorySessionStore } from '../fakes/in-memory-session-store.js'
import { InMemoryOtpStore } from '../fakes/in-memory-otp-store.js'
import { FakeEventPublisher } from '../fakes/fake-event-publisher.js'
import { RateLimiter } from '../../src/modules/rate-limit/rate-limiter.js'

describe('Auth Flow E2E', () => {
  let app, baseUrl, otpStore

  beforeAll(async () => {
    otpStore = InMemoryOtpStore()
    const result = await createApp({
      overrides: {
        userRepository: InMemoryUserRepository(),
        sessionStore: InMemorySessionStore(),
        otpStore,
        eventPublisher: FakeEventPublisher(),
        emailPublisher: FakeEventPublisher(),
        rateLimiters: {
          login: RateLimiter({ store: new Map(), maxAttempts: 100, windowMs: 60 * 60 * 1000 }),
          register: RateLimiter({ store: new Map(), maxAttempts: 100, windowMs: 60 * 60 * 1000 }),
          otp: RateLimiter({ store: new Map(), maxAttempts: 100, windowMs: 60 * 60 * 1000 }),
        }
      },
      config: {
        database: { url: '' },
        redis: { url: '' },
        rabbitmq: { url: '' },
        session: { ttlHours: 168 },
        google: { clientId: '', clientSecret: '' },
        apple: { clientId: '', teamId: '', keyId: '', privateKeyPath: '' },
        serviceKey: 'test-key',
        allowedOrigins: ['http://localhost'],
        port: 0
      }
    })
    app = result.app
    baseUrl = `http://localhost:${result.port}`
  })

  afterAll(() => app?.stop?.())

  const register = async (email, password, displayName) => {
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName })
    })
    return res
  }

  const verifyEmail = async (email) => {
    const otp = await otpStore.get(email)
    const res = await fetch(`${baseUrl}/auth/register/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: otp.code })
    })
    return res
  }

  it('register returns needsVerification', async () => {
    const res = await register('test@example.com', 'Password123!', 'Test')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.needsVerification).toBe(true)
    expect(body.token).toBeUndefined()
  })

  it('verify issues session token', async () => {
    const res = await verifyEmail('test@example.com')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBeDefined()
    expect(body.userId).toBeDefined()
  })

  it('login works after verification', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'Password123!' })
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBeDefined()
  })

  it('login blocked before verification', async () => {
    await register('unverified@example.com', 'Password123!', 'UV')
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unverified@example.com', password: 'Password123!' })
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.needsVerification).toBe(true)
  })

  it('re-register for unverified user resends OTP', async () => {
    const res = await register('unverified@example.com', 'NewPassword123!', 'UV')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.needsVerification).toBe(true)
  })

  it('re-register for verified user returns needsVerification silently', async () => {
    const res = await register('test@example.com', 'Password123!', 'Test')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.needsVerification).toBe(true)
  })

  it('rejects wrong password', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'wrong' })
    })
    expect(res.status).toBe(401)
  })

  it('validates session token', async () => {
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'Password123!' })
    })
    const { token } = await login.json()

    const res = await fetch(`${baseUrl}/auth/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Service-Key': 'test-key' },
      body: JSON.stringify({ token })
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.valid).toBe(true)
    expect(body.userId).toBeDefined()
  })

  it('logout invalidates token', async () => {
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'Password123!' })
    })
    const { token } = await login.json()

    await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    })

    const validate = await fetch(`${baseUrl}/auth/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Service-Key': 'test-key' },
      body: JSON.stringify({ token })
    })
    const body = await validate.json()
    expect(body.valid).toBe(false)
  })

  it('returns health check', async () => {
    const res = await fetch(`${baseUrl}/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.service).toBe('auth-service')
  })

  it('rejects validate without service key', async () => {
    const res = await fetch(`${baseUrl}/auth/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'any' })
    })
    expect(res.status).toBe(403)
  })

  it('register/verify returns needsDisplayName when no display name', async () => {
    await register('noname@example.com', 'Password123!')
    const res = await verifyEmail('noname@example.com')
    const body = await res.json()
    expect(body.token).toBeDefined()
    expect(body.needsDisplayName).toBe(true)
  })

  it('register/verify does not return needsDisplayName when display name exists', async () => {
    await register('named@example.com', 'Password123!', 'named_user')
    const res = await verifyEmail('named@example.com')
    const body = await res.json()
    expect(body.needsDisplayName).toBeUndefined()
  })

  it('GET /auth/me returns needsDisplayName when null', async () => {
    await register('me_noname@example.com', 'Password123!')
    const verifyRes = await verifyEmail('me_noname@example.com')
    const { token } = await verifyRes.json()
    const res = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const body = await res.json()
    expect(body.needsDisplayName).toBe(true)
  })

  it('POST /auth/profile/display-name sets name successfully', async () => {
    await register('setname@example.com', 'Password123!')
    const verifyRes = await verifyEmail('setname@example.com')
    const { token } = await verifyRes.json()
    const res = await fetch(`${baseUrl}/auth/profile/display-name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName: 'my_username' })
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.displayName).toBe('my_username')
  })

  it('POST /auth/profile/display-name rejects invalid format', async () => {
    await register('badname@example.com', 'Password123!')
    const verifyRes = await verifyEmail('badname@example.com')
    const { token } = await verifyRes.json()
    const res = await fetch(`${baseUrl}/auth/profile/display-name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName: 'AB' })
    })
    expect(res.status).toBe(400)
  })

  it('POST /auth/profile/display-name rejects duplicate', async () => {
    await register('dup1@example.com', 'Password123!', 'unique_name1')
    await verifyEmail('dup1@example.com')
    await register('dup2@example.com', 'Password123!')
    const verifyRes = await verifyEmail('dup2@example.com')
    const { token } = await verifyRes.json()
    const res = await fetch(`${baseUrl}/auth/profile/display-name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ displayName: 'unique_name1' })
    })
    expect(res.status).toBe(409)
  })

  it('POST /auth/profile/display-name rejects unauthorized', async () => {
    const res = await fetch(`${baseUrl}/auth/profile/display-name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'test_name' })
    })
    expect(res.status).toBe(401)
  })

  it('login returns needsDisplayName when no display name', async () => {
    await register('loginndn@example.com', 'Password123!')
    await verifyEmail('loginndn@example.com')
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'loginndn@example.com', password: 'Password123!' })
    })
    const body = await res.json()
    expect(body.needsDisplayName).toBe(true)
  })
})
