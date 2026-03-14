const createUser = ({ email, displayName = null }) => ({
  email: email.toLowerCase().trim(),
  displayName
})

export { createUser }
