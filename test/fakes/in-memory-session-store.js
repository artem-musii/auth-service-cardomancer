const InMemorySessionStore = () => {
  const sessions = new Map()

  const set = async (token, data, _ttlSeconds) => {
    sessions.set(token, { ...data })
  }

  const get = async (token) => sessions.get(token) || null

  const getAndRefresh = async (token, _fullTtlSeconds) => {
    return sessions.get(token) || null
  }

  const del = async (token) => {
    sessions.delete(token)
  }

  const deleteAllForUser = async (userId) => {
    const tokens = []
    for (const [token, data] of sessions) {
      if (data.userId === userId) {
        tokens.push(token)
        sessions.delete(token)
      }
    }
    return tokens
  }

  return { set, get, getAndRefresh, delete: del, deleteAllForUser }
}

export { InMemorySessionStore }
