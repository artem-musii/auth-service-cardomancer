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

  it('soft-deletes user and publishes user.deleted', async () => {
    const { service, events } = setup()
    const user = await service.createUser({ email: 'a@b.com' })
    await service.deleteUser(user.id)
    const found = await service.findById(user.id)
    expect(found.deletedAt).not.toBeNull()
    expect(events.published.find((e) => e.type === 'user.deleted')).toBeTruthy()
  })
})
