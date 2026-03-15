import { createUser } from './user-entity.js'
import { validateDisplayName } from './display-name.js'

const UserService = ({ userRepository, eventPublisher }) => {
  const createUserCmd = async ({ email, displayName }) => {
    const normalized = createUser({ email, displayName })
    const existing = await userRepository.findByEmail(normalized.email)
    if (existing) throw new Error('Email already registered')
    const user = await userRepository.create(normalized)
    await eventPublisher.publish({
      id: crypto.randomUUID(),
      type: 'user.created',
      timestamp: new Date().toISOString(),
      payload: { userId: user.id, email: user.email }
    })
    return user
  }

  const findById = (id) => userRepository.findById(id)
  const findByEmail = (email) => userRepository.findByEmail(email.toLowerCase().trim())

  const deleteUser = async (id) => {
    await userRepository.update(id, { deletedAt: new Date() })
    await eventPublisher.publish({
      id: crypto.randomUUID(),
      type: 'user.deleted',
      timestamp: new Date().toISOString(),
      payload: { userId: id }
    })
  }

  const verifyEmail = async (email) => {
    const user = await userRepository.findByEmail(email.toLowerCase().trim())
    if (!user) throw new Error('User not found')
    return userRepository.update(user.id, { emailVerifiedAt: new Date() })
  }

  const updateDisplayName = async (userId, displayName) => {
    if (!validateDisplayName(displayName)) throw new Error('Invalid display name')
    const existing = await userRepository.findByDisplayName(displayName)
    if (existing && existing.id !== userId) throw new Error('Display name already taken')
    return userRepository.update(userId, { displayName })
  }

  return { createUser: createUserCmd, findById, findByEmail, deleteUser, verifyEmail, updateDisplayName }
}

export { UserService }
