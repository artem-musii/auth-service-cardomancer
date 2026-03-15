const InMemoryOtpStore = () => {
  const otps = new Map()
  const cooldowns = new Set()

  const set = async (email, code, _ttlSeconds) => {
    otps.set(email, { code, attemptsLeft: 3 })
  }

  const get = async (email) => otps.get(email) || null

  const decrementAttempts = async (email) => {
    const otp = otps.get(email)
    if (!otp) return 0
    otp.attemptsLeft--
    if (otp.attemptsLeft <= 0) otps.delete(email)
    return otp.attemptsLeft
  }

  const del = async (email) => { otps.delete(email) }

  const getCooldown = async (email) => cooldowns.has(email)

  const setCooldown = async (email, _ttlSeconds) => { cooldowns.add(email) }

  const pendingPasswords = new Map()

  const setPendingPassword = async (email, hash) => {
    pendingPasswords.set(email, hash)
  }

  const getPendingPassword = async (email) => {
    const hash = pendingPasswords.get(email) || null
    pendingPasswords.delete(email)
    return hash
  }

  return { set, get, decrementAttempts, delete: del, getCooldown, setCooldown, setPendingPassword, getPendingPassword }
}

export { InMemoryOtpStore }
