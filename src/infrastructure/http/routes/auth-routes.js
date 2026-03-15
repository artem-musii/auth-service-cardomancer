const authRoutes = (app, { userService, sessionService, passwordService, userRepository, rateLimiters, otpService }) => {
  app.post('/auth/register', async ({ body, set, server, request }) => {
    const { email, password, displayName } = body
    if (!email || !password) { set.status = 400; return { error: 'Email and password required' } }

    const ip = server?.requestIP(request)?.address || 'unknown'
    const rl = rateLimiters.register.check(ip)
    if (!rl.allowed) { set.status = 429; return { error: 'Too many attempts, try again later' } }

    const normalizedEmail = email.toLowerCase().trim()
    const existing = await userService.findByEmail(normalizedEmail)

    if (existing && existing.emailVerifiedAt) {
      // Case 1: verified user — silent no-op to prevent enumeration
      return { needsVerification: true }
    }

    if (existing && !existing.emailVerifiedAt) {
      // Case 2: unverified user — update password + resend OTP
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
      return { needsVerification: true }
    }

    // Case 3: new user
    try {
      const user = await userService.createUser({ email, displayName })
      const hash = await passwordService.hash(password)
      await userRepository.createAuthMethod({ userId: user.id, provider: 'password', providerId: normalizedEmail, passwordHash: hash })
      try { await otpService.requestOtp(normalizedEmail) } catch {}
      return { needsVerification: true }
    } catch (e) {
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
    return sessionService.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
  })

  app.post('/auth/login', async ({ body, set }) => {
    const { email, password } = body
    if (!email || !password) { set.status = 400; return { error: 'Email and password required' } }

    const rl = rateLimiters.login.check(email.toLowerCase().trim())
    if (!rl.allowed) { set.status = 429; return { error: 'Too many attempts, try again later' } }

    const user = await userService.findByEmail(email)
    if (!user || user.deletedAt) { set.status = 401; return { error: 'Invalid credentials' } }

    const methods = await userRepository.findAuthMethodsByUserId(user.id)
    const pwMethod = methods.find((m) => m.provider === 'password')
    if (!pwMethod) { set.status = 401; return { error: 'Invalid credentials' } }

    const valid = await passwordService.verify(password, pwMethod.passwordHash)
    if (!valid) { set.status = 401; return { error: 'Invalid credentials' } }

    if (!user.emailVerifiedAt) { set.status = 403; return { error: 'Email not verified', needsVerification: true } }

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
