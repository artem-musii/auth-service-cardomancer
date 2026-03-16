const LUA_SCRIPT = `local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count`

const RedisRateLimiter = ({ redis, prefix, maxAttempts, windowSeconds }) => {
  const check = async (key) => {
    const fullKey = `rl:${prefix}:${key}`

    const count = Number(await redis.send('EVAL', [LUA_SCRIPT, '1', fullKey, String(windowSeconds)]))

    if (count > maxAttempts) {
      const ttl = await redis.ttl(fullKey)
      return { allowed: false, remaining: 0, retryAfterMs: ttl * 1000 }
    }

    return { allowed: true, remaining: maxAttempts - count, retryAfterMs: 0 }
  }

  return { check }
}

export { RedisRateLimiter }
