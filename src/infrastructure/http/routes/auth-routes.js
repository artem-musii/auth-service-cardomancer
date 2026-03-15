const maskEmail = (email) => {
  const [local, domain] = email.split('@')
  return `${local.slice(0, 3)}***@${domain}`
}

const authRoutes = (app, { userService, sessionService, passwordService, userRepository, rateLimiters, otpService, log }) => {
  app.post('/auth/register', async ({ body, set, server, request }) => {
    const { email, password, displayName } = body
    if (!email || !password) { set.status = 400; return { error: 'Email and password required' } }

    log.debug('register attempt', { email: maskEmail(email) })

    const ip = server?.requestIP(request)?.address || 'unknown'
    const rl = rateLimiters.register.check(ip)
    if (!rl.allowed) { log.warn('register rate limit hit', { ip }); set.status = 429; return { error: 'Too many attempts, try again later' } }

    const normalizedEmail = email.toLowerCase().trim()
    const existing = await userService.findByEmail(normalizedEmail)

    if (existing && existing.emailVerifiedAt) {
      log.info('register silent no-op for verified user', { email: maskEmail(normalizedEmail) })
      return { needsVerification: true }
    }

    if (existing && !existing.emailVerifiedAt) {
      const hash = await passwordService.hash(password)
      const methods = await userRepository.findAuthMethodsByUserId(existing.id)
      const pwMethod = methods.find((m) => m.provider === 'password')
      if (pwMethod) {
        await userRepository.updateAuthMethod(pwMethod.id, { passwordHash: hash })
      } else {
        await userRepository.createAuthMethod({ userId: existing.id, provider: 'password', providerId: normalizedEmail, passwordHash: hash })
      }
      if (displayName) await userRepository.update(existing.id, { displayName })
      try { await otpService.requestOtp(normalizedEmail) } catch {}
      log.info('re-register unverified user', { email: maskEmail(normalizedEmail) })
      return { needsVerification: true }
    }

    try {
      const user = await userService.createUser({ email, displayName })
      const hash = await passwordService.hash(password)
      await userRepository.createAuthMethod({ userId: user.id, provider: 'password', providerId: normalizedEmail, passwordHash: hash })
      try { await otpService.requestOtp(normalizedEmail) } catch {}
      log.info('new user registered', { email: maskEmail(normalizedEmail) })
      return { needsVerification: true }
    } catch (e) {
      log.error('registration failed', { email: maskEmail(email), error: e.message })
      set.status = 409; return { error: e.message }
    }
  })

  app.post('/auth/register/verify', async ({ body, set }) => {
    const { email, code } = body
    if (!email || !code) { set.status = 400; return { error: 'Email and code required' } }

    const normalizedEmail = email.toLowerCase().trim()
    const rl = rateLimiters.otp.check(normalizedEmail)
    if (!rl.allowed) { set.status = 429; return { error: 'Too many attempts, try again later' } }

    const user = await userService.findByEmail(normalizedEmail)
    if (!user) { set.status = 404; return { error: 'User not found' } }
    if (user.emailVerifiedAt) { set.status = 400; return { error: 'Already verified' } }

    const result = await otpService.verifyOtp(normalizedEmail, code)
    if (!result.valid) { set.status = 401; return { error: 'Invalid or expired code' } }

    await userService.verifyEmail(normalizedEmail)
    const session = await sessionService.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
    if (!user.displayName) session.needsDisplayName = true
    return session
  })

  app.post('/auth/login', async ({ body, set }) => {
    const { email, password } = body
    if (!email || !password) { set.status = 400; return { error: 'Email and password required' } }

    log.debug('login attempt', { email: maskEmail(email) })

    const rl = rateLimiters.login.check(email.toLowerCase().trim())
    if (!rl.allowed) { log.warn('login rate limit hit', { email: maskEmail(email) }); set.status = 429; return { error: 'Too many attempts, try again later' } }

    const user = await userService.findByEmail(email)
    if (!user || user.deletedAt) { set.status = 401; return { error: 'Invalid credentials' } }

    const methods = await userRepository.findAuthMethodsByUserId(user.id)
    const pwMethod = methods.find((m) => m.provider === 'password')
    if (!pwMethod) {
      const providers = methods.map((m) => m.provider)
      log.info('login without password method', { email: maskEmail(email), providers })
      set.status = 400
      return { error: 'This account uses a different login method', useOtp: true, providers }
    }

    const valid = await passwordService.verify(password, pwMethod.passwordHash)
    if (!valid) { set.status = 401; return { error: 'Invalid credentials' } }

    if (!user.emailVerifiedAt) { log.warn('login with unverified email', { email: maskEmail(email) }); set.status = 403; return { error: 'Email not verified', needsVerification: true } }

    log.info('login successful', { email: maskEmail(email) })
    const session = await sessionService.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
    if (!user.displayName) session.needsDisplayName = true
    return session
  })

  app.get('/auth/me', async ({ headers, set }) => {
    const token = headers.authorization?.replace('Bearer ', '')
    if (!token) { set.status = 401; return { error: 'No token' } }
    const result = await sessionService.validate(token)
    if (!result.valid) { set.status = 401; return { error: 'Invalid session' } }
    if (!result.displayName) result.needsDisplayName = true
    return result
  })

  app.post('/auth/logout', async ({ headers, set }) => {
    const token = headers.authorization?.replace('Bearer ', '')
    if (!token) { set.status = 401; return { error: 'No token' } }
    await sessionService.revoke(token)
    log.info('logout successful')
    return { ok: true }
  })

  app.post('/auth/profile/display-name', async ({ body, headers, set }) => {
    const token = headers.authorization?.replace('Bearer ', '')
    if (!token) { set.status = 401; return { error: 'No token' } }
    const session = await sessionService.validate(token)
    if (!session.valid) { set.status = 401; return { error: 'Invalid session' } }
    const { displayName } = body
    if (!displayName) { set.status = 400; return { error: 'Display name required' } }
    try {
      await userService.updateDisplayName(session.userId, displayName)
      await sessionService.updateSessionDisplayName(token, displayName)
      return { displayName }
    } catch (e) {
      if (e.message === 'Invalid display name') { set.status = 400; return { error: e.message } }
      if (e.message === 'Display name already taken') { set.status = 409; return { error: e.message } }
      set.status = 500; return { error: 'Internal error' }
    }
  })

  return app
}

export { authRoutes }
