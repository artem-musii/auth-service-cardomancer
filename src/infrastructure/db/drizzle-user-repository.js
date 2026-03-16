import { eq, and } from 'drizzle-orm'
import { users, authMethods } from './schema.js'

const DrizzleUserRepository = (db) => {
  const findById = async (id) => {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
    return rows[0] || null
  }

  const findByEmail = async (email) => {
    const rows = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1)
    return rows[0] || null
  }

  const findByDisplayName = async (displayName) => {
    const rows = await db.select().from(users).where(eq(users.displayName, displayName)).limit(1)
    return rows[0] || null
  }

  const create = async ({ email, displayName = null }) => {
    const rows = await db.insert(users).values({ email, displayName }).returning()
    return rows[0]
  }

  const update = async (id, data) => {
    const rows = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning()
    return rows[0]
  }

  const findAuthMethod = async (provider, providerId) => {
    const rows = await db
      .select()
      .from(authMethods)
      .where(and(eq(authMethods.provider, provider), eq(authMethods.providerId, providerId)))
      .limit(1)
    return rows[0] || null
  }

  const findAuthMethodsByUserId = async (userId) => db.select().from(authMethods).where(eq(authMethods.userId, userId))

  const createAuthMethod = async ({ userId, provider, providerId = null, passwordHash = null }) => {
    const rows = await db.insert(authMethods).values({ userId, provider, providerId, passwordHash }).returning()
    return rows[0]
  }

  const updateAuthMethod = async (id, data) => {
    const rows = await db.update(authMethods).set(data).where(eq(authMethods.id, id)).returning()
    return rows[0]
  }

  return {
    findById,
    findByEmail,
    findByDisplayName,
    create,
    update,
    findAuthMethod,
    findAuthMethodsByUserId,
    createAuthMethod,
    updateAuthMethod,
  }
}

export { DrizzleUserRepository }
