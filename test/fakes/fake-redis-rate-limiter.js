const FakeRedisRateLimiter = ({ prefix, maxAttempts, windowMs }) => {
  const store = new Map()

  const check = async (key) => {
    const now = Date.now()
    const fullKey = `${prefix}:${key}`
    const entry = store.get(fullKey)

    if (!entry || now - entry.start >= windowMs) {
      store.set(fullKey, { count: 1, start: now })
      return { allowed: true, remaining: maxAttempts - 1, retryAfterMs: 0 }
    }

    if (entry.count >= maxAttempts) {
      return { allowed: false, remaining: 0, retryAfterMs: windowMs - (now - entry.start) }
    }

    entry.count++
    return { allowed: true, remaining: maxAttempts - entry.count, retryAfterMs: 0 }
  }

  const reset = () => store.clear()

  return { check, reset }
}

export { FakeRedisRateLimiter }
