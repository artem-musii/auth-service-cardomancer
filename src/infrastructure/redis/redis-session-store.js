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

  const del = async (token) => {
    const data = await get(token)
    await redis.del(SESSION_PREFIX + token)
    if (data) await redis.srem(USER_SESSIONS_PREFIX + data.userId, token)
  }

  const deleteAllForUser = async (userId) => {
    const tokens = await redis.smembers(USER_SESSIONS_PREFIX + userId)
    for (const token of tokens) {
      await redis.del(SESSION_PREFIX + token)
    }
    await redis.del(USER_SESSIONS_PREFIX + userId)
    return tokens
  }

  return { set, get, delete: del, deleteAllForUser }
}

export { RedisSessionStore }
