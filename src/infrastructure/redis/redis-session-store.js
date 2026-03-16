const SESSION_PREFIX = 'session:'
const USER_SESSIONS_PREFIX = 'user-sessions:'

const RedisSessionStore = (redis) => {
  const set = async (token, data, ttlSeconds) => {
    const key = SESSION_PREFIX + token
    await redis.set(key, JSON.stringify(data), 'EX', ttlSeconds)
    await redis.sadd(USER_SESSIONS_PREFIX + data.userId, token)
    await redis.expire(USER_SESSIONS_PREFIX + data.userId, ttlSeconds)
  }

  const get = async (token) => {
    const raw = await redis.get(SESSION_PREFIX + token)
    return raw ? JSON.parse(raw) : null
  }

  const getAndRefresh = async (token, fullTtlSeconds) => {
    const raw = await redis.get(SESSION_PREFIX + token)
    if (!raw) return null
    const data = JSON.parse(raw)

    const ttl = await redis.ttl(SESSION_PREFIX + token)
    const threshold = Math.floor(fullTtlSeconds * 0.85)
    if (ttl > 0 && ttl < threshold) {
      await redis.expire(SESSION_PREFIX + token, fullTtlSeconds)
      if (data.userId) {
        await redis.expire(USER_SESSIONS_PREFIX + data.userId, fullTtlSeconds)
      }
    }

    return data
  }

  const del = async (token) => {
    const data = await get(token)
    await redis.del(SESSION_PREFIX + token)
    if (data) await redis.srem(USER_SESSIONS_PREFIX + data.userId, token)
  }

  const deleteAllForUser = async (userId) => {
    const tokens = await redis.smembers(USER_SESSIONS_PREFIX + userId)
    await Promise.all([
      ...tokens.map((token) => redis.del(SESSION_PREFIX + token)),
      redis.del(USER_SESSIONS_PREFIX + userId),
    ])
    return tokens
  }

  return { set, get, getAndRefresh, delete: del, deleteAllForUser }
}

export { RedisSessionStore }
