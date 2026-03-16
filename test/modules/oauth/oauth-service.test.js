import { describe, it, expect } from 'bun:test'
import { OAuthService } from '../../../src/modules/oauth/oauth-service.js'
import { InMemoryUserRepository } from '../../fakes/in-memory-user-repository.js'
import { InMemorySessionStore } from '../../fakes/in-memory-session-store.js'
import { FakeEventPublisher } from '../../fakes/fake-event-publisher.js'
import { FakeOAuthProvider } from '../../fakes/fake-oauth-provider.js'
import { UserService } from '../../../src/modules/identity/user-service.js'
import { SessionService } from '../../../src/modules/session/session-service.js'

describe('OAuthService', () => {
  const setup = () => {
    const userRepo = InMemoryUserRepository()
    const sessionStore = InMemorySessionStore()
    const events = FakeEventPublisher()
    const userService = UserService({ userRepository: userRepo, eventPublisher: events })
    const sessionService = SessionService({ sessionStore, eventPublisher: events, sessionTtlHours: 168 })
    const googleProvider = FakeOAuthProvider({
      userInfo: { providerId: 'g123', email: 'user@gmail.com', displayName: 'G User' },
    })
    const service = OAuthService({
      userService,
      sessionService,
      userRepository: userRepo,
      providers: { google: googleProvider },
    })
    return { service, userRepo, events, userService }
  }

  it('creates new user on first OAuth login', async () => {
    const { service } = setup()
    const result = await service.handleCallback('google', 'code123')
    expect(result.token).toBeDefined()
    expect(result.userId).toBeDefined()
  })

  it('links to existing user with same email', async () => {
    const { service, userService } = setup()
    const existing = await userService.createUser({ email: 'user@gmail.com', displayName: 'Existing' })
    const result = await service.handleCallback('google', 'code123')
    expect(result.userId).toBe(existing.id)
  })

  it('reuses existing auth method on repeat login', async () => {
    const { service, userRepo } = setup()
    await service.handleCallback('google', 'code123')
    await service.handleCallback('google', 'code123')
    const user = await userRepo.findByEmail('user@gmail.com')
    const methods = await userRepo.findAuthMethodsByUserId(user.id)
    const googleMethods = methods.filter((m) => m.provider === 'google')
    expect(googleMethods.length).toBe(1)
  })

  it('throws for unknown provider', async () => {
    const { service } = setup()
    await expect(service.handleCallback('github', 'code')).rejects.toThrow()
  })

  it('sets emailVerifiedAt on new OAuth user', async () => {
    const { service, userRepo } = setup()
    await service.handleCallback('google', 'code123')
    const user = await userRepo.findByEmail('user@gmail.com')
    expect(user.emailVerifiedAt).not.toBeNull()
  })
})
