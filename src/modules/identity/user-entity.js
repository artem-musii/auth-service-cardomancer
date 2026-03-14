const createUser = ({ email, displayName = null }) => ({
  email: email.toLowerCase().trim(),
  displayName
})

const isDeleted = (user) => user.deletedAt !== null

export { createUser, isDeleted }
