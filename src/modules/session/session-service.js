import { createSession } from './session-entity.js'

const SessionService = ({ sessionStore, eventPublisher, sessionTtlHours }) => {
  const createSessionCmd = async ({ userId, email, displayName }) => {
    const oldTokens = await sessionStore.deleteAllForUser(userId)
    for (const oldToken of oldTokens) {
      await eventPublisher.publish({
        id: crypto.randomUUID(),
        type: 'session.revoked',
        timestamp: new Date().toISOString(),
        payload: { userId, token: oldToken }
      })
    }
    const session = createSession({ userId, email, displayName, ttlHours: sessionTtlHours })
    await sessionStore.set(session.token, session.data, session.ttlSeconds)
    return { token: session.token, userId, expiresAt: session.expiresAt }
  }

  const validate = async (token) => {
    const data = await sessionStore.get(token)
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
        payload: { userId: data.userId, token }
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
        payload: { userId, token }
      })
    }
    return tokens
  }

  return { createSession: createSessionCmd, validate, revoke, revokeAllForUser }
}

export { SessionService }
