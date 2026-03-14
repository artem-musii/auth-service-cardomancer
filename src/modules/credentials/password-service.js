const PasswordService = () => {
  const hash = (password) => Bun.password.hash(password, { algorithm: 'argon2id' })
  const verify = (password, hashed) => Bun.password.verify(password, hashed)
  return { hash, verify }
}

export { PasswordService }
