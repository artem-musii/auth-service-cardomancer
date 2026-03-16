import { describe, it, expect, beforeEach } from 'bun:test'
import { FakeRedisRateLimiter } from '../../fakes/fake-redis-rate-limiter.js'

describe('RedisRateLimiter', () => {
  let limiter

  beforeEach(() => {
    limiter = FakeRedisRateLimiter({ prefix: 'test', maxAttempts: 3, windowMs: 60000 })
  })

  it('allows requests under limit and decreases remaining', async () => {
    const r1 = await limiter.check('key1')
    expect(r1.allowed).toBe(true)
    expect(r1.remaining).toBe(2)

    const r2 = await limiter.check('key1')
    expect(r2.allowed).toBe(true)
    expect(r2.remaining).toBe(1)

    const r3 = await limiter.check('key1')
    expect(r3.allowed).toBe(true)
    expect(r3.remaining).toBe(0)
  })

  it('blocks after max attempts reached', async () => {
    await limiter.check('key1')
    await limiter.check('key1')
    await limiter.check('key1')

    const blocked = await limiter.check('key1')
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  it('returns retryAfterMs > 0 when blocked', async () => {
    await limiter.check('key1')
    await limiter.check('key1')
    await limiter.check('key1')

    const blocked = await limiter.check('key1')
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  it('isolates different keys', async () => {
    await limiter.check('keyA')
    await limiter.check('keyA')
    await limiter.check('keyA')

    const blocked = await limiter.check('keyA')
    expect(blocked.allowed).toBe(false)

    const r = await limiter.check('keyB')
    expect(r.allowed).toBe(true)
  })
})
