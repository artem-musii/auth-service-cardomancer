const OTP_PREFIX = 'otp:'
const COOLDOWN_PREFIX = 'otp-cooldown:'
const PENDING_PW_PREFIX = 'pending-pw:'

const RedisOtpStore = (redis) => {
  const set = async (email, code, ttlSeconds) => {
    const key = OTP_PREFIX + email
    await redis.set(key, JSON.stringify({ code, attemptsLeft: 3 }), 'EX', ttlSeconds)
  }

  const get = async (email) => {
    const raw = await redis.get(OTP_PREFIX + email)
    return raw ? JSON.parse(raw) : null
  }

  const decrementAttempts = async (email) => {
    const data = await get(email)
    if (!data) return 0
    data.attemptsLeft--
    if (data.attemptsLeft <= 0) {
      await redis.del(OTP_PREFIX + email)
      return 0
    }
    const ttl = await redis.ttl(OTP_PREFIX + email)
    await redis.set(OTP_PREFIX + email, JSON.stringify(data), 'EX', ttl > 0 ? ttl : 300)
    return data.attemptsLeft
  }

  const del = async (email) => { await redis.del(OTP_PREFIX + email) }

  const getCooldown = async (email) => {
    const exists = await redis.exists(COOLDOWN_PREFIX + email)
    return exists === 1
  }

  const setCooldown = async (email, ttlSeconds) => {
    await redis.set(COOLDOWN_PREFIX + email, '1', 'EX', ttlSeconds)
  }

  const setPendingPassword = async (email, hash, ttlSeconds) => {
    await redis.set(PENDING_PW_PREFIX + email, hash, 'EX', ttlSeconds)
  }

  const getPendingPassword = async (email) => {
    const raw = await redis.get(PENDING_PW_PREFIX + email)
    if (raw) await redis.del(PENDING_PW_PREFIX + email)
    return raw
  }

  return { set, get, decrementAttempts, delete: del, getCooldown, setCooldown, setPendingPassword, getPendingPassword }
}

export { RedisOtpStore }
