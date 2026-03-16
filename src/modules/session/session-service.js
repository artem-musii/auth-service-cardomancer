import { createHash } from 'crypto'
import { createSession } from './session-entity.js'

const hashToken = (token) => createHash('sha256').update(token).digest('hex').slice(0, 16)

const SessionService = ({ sessionStore, eventPublisher, sessionTtlHours }) => {
  const createSessionCmd = async ({ userId, email, displayName }) => {
    const oldTokens = await sessionStore.deleteAllForUser(userId)
    for (const oldToken of oldTokens) {
      await eventPublisher.publish({
        id: crypto.randomUUID(),
        type: 'session.revoked',
        timestamp: new Date().toISOString(),
        payload: { userId, tokenHash: hashToken(oldToken) },
      })
    }
    const session = createSession({ userId, email, displayName, ttlHours: sessionTtlHours })
    await sessionStore.set(session.token, session.data, session.ttlSeconds)
    return { token: session.token, userId, expiresAt: session.expiresAt, displayName }
  }

  const validate = async (token) => {
    const data = await sessionStore.getAndRefresh(token, sessionTtlHours * 3600)
    if (!data) return { valid: false }
    return { valid: true, userId: data.userId, email: data.email, displayName: data.displayName }
  }

  const revoke = async (token) => {
    const data = await sessionStore.get(token)
    await sessionStore.delete(token)
    if (data) {
      await eventPublisher.publish({
        id: crypto.randomUUID(),
        type: 'session.revoked',
        timestamp: new Date().toISOString(),
        payload: { userId: data.userId, tokenHash: hashToken(token) },
      })
    }
  }

  const revokeAllForUser = async (userId) => {
    const tokens = await sessionStore.deleteAllForUser(userId)
    for (const token of tokens) {
      await eventPublisher.publish({
        id: crypto.randomUUID(),
        type: 'session.revoked',
        timestamp: new Date().toISOString(),
        payload: { userId, tokenHash: hashToken(token) },
      })
    }
    return tokens
  }

  const updateSessionDisplayName = async (token, displayName) => {
    const data = await sessionStore.get(token)
    if (!data) return null
    data.displayName = displayName
    const ttlSeconds = Math.max(0, Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000))
    await sessionStore.set(token, data, ttlSeconds)
    return data
  }

  return { createSession: createSessionCmd, validate, revoke, revokeAllForUser, updateSessionDisplayName }
}

export { SessionService }
