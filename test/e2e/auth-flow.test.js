import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { createApp } from '../../src/index.js'
import { InMemoryUserRepository } from '../fakes/in-memory-user-repository.js'
import { InMemorySessionStore } from '../fakes/in-memory-session-store.js'
import { InMemoryOtpStore } from '../fakes/in-memory-otp-store.js'
import { FakeEventPublisher } from '../fakes/fake-event-publisher.js'

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
        emailPublisher: FakeEventPublisher()
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
})
