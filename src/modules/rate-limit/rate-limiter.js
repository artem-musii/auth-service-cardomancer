const RateLimiter = ({ store, maxAttempts, windowMs }) => {
  const check = (key) => {
    const now = Date.now()
    const entry = store.get(key)

    if (!entry || now - entry.start >= windowMs) {
      store.set(key, { count: 1, start: now })
      return { allowed: true, remaining: maxAttempts - 1 }
    }

    if (entry.count >= maxAttempts) {
      return { allowed: false, remaining: 0, retryAfterMs: windowMs - (now - entry.start) }
    }

    entry.count++
    return { allowed: true, remaining: maxAttempts - entry.count }
  }

  return { check }
}

export { RateLimiter }
