import { describe, it, expect } from 'bun:test'
import { RateLimiter } from '../../../src/modules/rate-limit/rate-limiter.js'

describe('RateLimiter', () => {
  it('allows requests within limit', () => {
    const store = new Map()
    const limiter = RateLimiter({ store, maxAttempts: 3, windowMs: 60000 })
    expect(limiter.check('key1')).toEqual({ allowed: true, remaining: 2 })
    expect(limiter.check('key1')).toEqual({ allowed: true, remaining: 1 })
    expect(limiter.check('key1')).toEqual({ allowed: true, remaining: 0 })
  })

  it('blocks requests over limit', () => {
    const store = new Map()
    const limiter = RateLimiter({ store, maxAttempts: 1, windowMs: 60000 })
    limiter.check('key1')
    const result = limiter.check('key1')
    expect(result.allowed).toBe(false)
  })

  it('isolates keys', () => {
    const store = new Map()
    const limiter = RateLimiter({ store, maxAttempts: 1, windowMs: 60000 })
    limiter.check('key1')
    expect(limiter.check('key2').allowed).toBe(true)
  })
})
