import { describe, it, expect } from 'bun:test'
import { UserService } from '../../../src/modules/identity/user-service.js'
import { InMemoryUserRepository } from '../../fakes/in-memory-user-repository.js'
import { FakeEventPublisher } from '../../fakes/fake-event-publisher.js'

describe('UserService', () => {
  const setup = () => {
    const repo = InMemoryUserRepository()
    const events = FakeEventPublisher()
    const service = UserService({ userRepository: repo, eventPublisher: events })
    return { service, repo, events }
  }

  it('creates a user and publishes user.created', async () => {
    const { service, events } = setup()
    const user = await service.createUser({ email: 'Test@Example.com', displayName: 'Test' })
    expect(user.email).toBe('test@example.com')
    expect(events.published).toHaveLength(1)
    expect(events.published[0].type).toBe('user.created')
  })

  it('rejects duplicate email', async () => {
    const { service } = setup()
    await service.createUser({ email: 'a@b.com' })
    await expect(service.createUser({ email: 'a@b.com' })).rejects.toThrow()
  })

  it('finds user by id', async () => {
    const { service } = setup()
    const user = await service.createUser({ email: 'a@b.com' })
    const found = await service.findById(user.id)
    expect(found.email).toBe('a@b.com')
  })

  it('finds user by email', async () => {
    const { service } = setup()
    await service.createUser({ email: 'a@b.com' })
    const found = await service.findByEmail('a@b.com')
    expect(found.email).toBe('a@b.com')
  })

  it('verifies email and sets emailVerifiedAt', async () => {
    const { service } = setup()
    const user = await service.createUser({ email: 'a@b.com' })
    expect(user.emailVerifiedAt).toBeNull()
    const verified = await service.verifyEmail('a@b.com')
    expect(verified.emailVerifiedAt).not.toBeNull()
  })

  it('verifyEmail throws if user not found', async () => {
    const { service } = setup()
    await expect(service.verifyEmail('nobody@x.com')).rejects.toThrow()
  })

  it('soft-deletes user and publishes user.deleted', async () => {
    const { service, events } = setup()
    const user = await service.createUser({ email: 'a@b.com' })
    await service.deleteUser(user.id)
    const found = await service.findById(user.id)
    expect(found.deletedAt).not.toBeNull()
    expect(events.published.find((e) => e.type === 'user.deleted')).toBeTruthy()
  })

  it('updateDisplayName validates and persists', async () => {
    const { service } = setup()
    const user = await service.createUser({ email: 'a@b.com' })
    const updated = await service.updateDisplayName(user.id, 'valid_name')
    expect(updated.displayName).toBe('valid_name')
  })

  it('updateDisplayName rejects invalid format', async () => {
    const { service } = setup()
    const user = await service.createUser({ email: 'a@b.com' })
    await expect(service.updateDisplayName(user.id, 'AB')).rejects.toThrow('Invalid display name')
  })

  it('updateDisplayName rejects duplicate', async () => {
    const { service, _repo } = setup()
    const u1 = await service.createUser({ email: 'a@b.com' })
    await service.updateDisplayName(u1.id, 'taken_name')
    const u2 = await service.createUser({ email: 'c@d.com' })
    await expect(service.updateDisplayName(u2.id, 'taken_name')).rejects.toThrow('Display name already taken')
  })
})
