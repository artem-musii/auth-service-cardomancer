const InMemoryUserRepository = () => {
  const users = new Map()
  const authMethods = []

  const create = async ({ email, displayName = null }) => {
    const user = {
      id: crypto.randomUUID(),
      email,
      displayName,
      emailVerifiedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    users.set(user.id, user)
    return user
  }

  const findById = async (id) => users.get(id) || null

  const findByEmail = async (email) => {
    for (const u of users.values()) {
      if (u.email === email) return u
    }
    return null
  }

  const findByDisplayName = async (displayName) => {
    for (const u of users.values()) {
      if (u.displayName === displayName) return u
    }
    return null
  }

  const update = async (id, data) => {
    const user = users.get(id)
    if (!user) throw new Error('User not found')
    Object.assign(user, data, { updatedAt: new Date() })
    return user
  }

  const findAuthMethod = async (provider, providerId) =>
    authMethods.find((m) => m.provider === provider && m.providerId === providerId) || null

  const findAuthMethodsByUserId = async (userId) => authMethods.filter((m) => m.userId === userId)

  const createAuthMethod = async ({ userId, provider, providerId = null, passwordHash = null }) => {
    const method = {
      id: crypto.randomUUID(),
      userId,
      provider,
      providerId,
      passwordHash,
      createdAt: new Date(),
    }
    authMethods.push(method)
    return method
  }

  const updateAuthMethod = async (id, data) => {
    const method = authMethods.find((m) => m.id === id)
    if (!method) throw new Error('Auth method not found')
    Object.assign(method, data)
    return method
  }

  return {
    create,
    findById,
    findByEmail,
    findByDisplayName,
    update,
    findAuthMethod,
    findAuthMethodsByUserId,
    createAuthMethod,
    updateAuthMethod,
  }
}

export { InMemoryUserRepository }
