import { describe, it, expect } from 'bun:test'
import { SessionService } from '../../../src/modules/session/session-service.js'
import { InMemorySessionStore } from '../../fakes/in-memory-session-store.js'
import { InMemoryUserRepository } from '../../fakes/in-memory-user-repository.js'
import { FakeEventPublisher } from '../../fakes/fake-event-publisher.js'

describe('SessionService', () => {
  const setup = async () => {
    const sessionStore = InMemorySessionStore()
    const userRepository = InMemoryUserRepository()
    const eventPublisher = FakeEventPublisher()
    const service = SessionService({
      sessionStore,
      userRepository,
      eventPublisher,
      sessionTtlHours: 168
    })
    const user = await userRepository.create({ email: 'a@b.com', displayName: 'A' })
    return { service, sessionStore, userRepository, eventPublisher, user }
  }

  it('creates a session and returns token', async () => {
    const { service, user } = await setup()
    const result = await service.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
    expect(result.token).toBeDefined()
    expect(result.userId).toBe(user.id)
    expect(result.expiresAt).toBeDefined()
  })

  it('validates a valid token', async () => {
    const { service, user } = await setup()
    const { token } = await service.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
    const result = await service.validate(token)
    expect(result.valid).toBe(true)
    expect(result.userId).toBe(user.id)
  })

  it('returns invalid for unknown token', async () => {
    const { service } = await setup()
    const result = await service.validate('bad-token')
    expect(result.valid).toBe(false)
  })

  it('enforces single session per user', async () => {
    const { service, sessionStore, user } = await setup()
    const first = await service.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
    const second = await service.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
    expect(await sessionStore.get(first.token)).toBeNull()
    expect(await sessionStore.get(second.token)).not.toBeNull()
  })

  it('publishes session.revoked on single-session enforcement', async () => {
    const { service, eventPublisher, user } = await setup()
    await service.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
    await service.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
    const revoked = eventPublisher.published.filter((e) => e.type === 'session.revoked')
    expect(revoked.length).toBeGreaterThanOrEqual(1)
  })

  it('revokes session on logout', async () => {
    const { service, sessionStore, user } = await setup()
    const { token } = await service.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
    await service.revoke(token)
    expect(await sessionStore.get(token)).toBeNull()
  })

  it('revokes all sessions for user', async () => {
    const { service, user } = await setup()
    await service.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
    const result = await service.revokeAllForUser(user.id)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it('createSession returns displayName', async () => {
    const { service } = await setup()
    const result = await service.createSession({ userId: 'u1', email: 'a@b.com', displayName: 'test_user' })
    expect(result.displayName).toBe('test_user')
  })

  it('updateSessionDisplayName updates session in Redis without creating new session', async () => {
    const { service, sessionStore } = await setup()
    const session = await service.createSession({ userId: 'u1', email: 'a@b.com', displayName: null })
    await service.updateSessionDisplayName(session.token, 'new_name')
    const data = await sessionStore.get(session.token)
    expect(data.displayName).toBe('new_name')
  })
})
