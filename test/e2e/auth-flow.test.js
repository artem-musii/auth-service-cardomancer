import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { createApp } from '../../src/index.js'
import { InMemoryUserRepository } from '../fakes/in-memory-user-repository.js'
import { InMemorySessionStore } from '../fakes/in-memory-session-store.js'
import { InMemoryOtpStore } from '../fakes/in-memory-otp-store.js'
import { FakeEventPublisher } from '../fakes/fake-event-publisher.js'

describe('Auth Flow E2E', () => {
  let app, baseUrl

  beforeAll(async () => {
    const result = await createApp({
      overrides: {
        userRepository: InMemoryUserRepository(),
        sessionStore: InMemorySessionStore(),
        otpStore: InMemoryOtpStore(),
        eventPublisher: FakeEventPublisher()
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

  it('registers a new user', async () => {
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'Password123!', displayName: 'Test' })
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBeDefined()
    expect(body.userId).toBeDefined()
  })

  it('logs in with correct password', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'Password123!' })
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBeDefined()
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
