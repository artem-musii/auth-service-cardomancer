import { randomBytes } from 'crypto'

const generateToken = () => randomBytes(32).toString('base64url')

const createSession = ({ userId, email, displayName, ttlHours }) => {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000)
  return {
    token: generateToken(),
    data: { userId, email, displayName, expiresAt },
    ttlSeconds: ttlHours * 60 * 60,
    expiresAt
  }
}

export { createSession }
