const authRoutes = (app, { userService, sessionService, passwordService, userRepository }) => {
  app.post('/auth/register', async ({ body, set }) => {
    const { email, password, displayName } = body
    if (!email || !password) { set.status = 400; return { error: 'Email and password required' } }

    try {
      const user = await userService.createUser({ email, displayName })
      const hash = await passwordService.hash(password)
      await userRepository.createAuthMethod({ userId: user.id, provider: 'password', providerId: email.toLowerCase().trim(), passwordHash: hash })
      return sessionService.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
    } catch (e) {
      set.status = 409; return { error: e.message }
    }
  })

  app.post('/auth/login', async ({ body, set }) => {
    const { email, password } = body
    if (!email || !password) { set.status = 400; return { error: 'Email and password required' } }

    const user = await userService.findByEmail(email)
    if (!user || user.deletedAt) { set.status = 401; return { error: 'Invalid credentials' } }

    const methods = await userRepository.findAuthMethodsByUserId(user.id)
    const pwMethod = methods.find((m) => m.provider === 'password')
    if (!pwMethod) { set.status = 401; return { error: 'Invalid credentials' } }

    const valid = await passwordService.verify(password, pwMethod.passwordHash)
    if (!valid) { set.status = 401; return { error: 'Invalid credentials' } }

    return sessionService.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
  })

  app.post('/auth/logout', async ({ headers, set }) => {
    const token = headers.authorization?.replace('Bearer ', '')
    if (!token) { set.status = 401; return { error: 'No token' } }
    await sessionService.revoke(token)
    return { ok: true }
  })

  return app
}

export { authRoutes }
