const otpRoutes = (app, { otpService, userService, sessionService, rateLimiters, userRepository }) => {
  app.post('/auth/otp/request', async ({ body, set }) => {
    const { email } = body
    if (!email) { set.status = 400; return { error: 'Email required' } }

    const rl = rateLimiters.otp.check(email.toLowerCase().trim())
    if (!rl.allowed) { set.status = 429; return { error: 'Too many attempts, try again later' } }

    try {
      await otpService.requestOtp(email)
      return { ok: true }
    } catch (e) {
      set.status = 429; return { error: e.message }
    }
  })

  app.post('/auth/otp/verify', async ({ body, set }) => {
    const { email, code } = body
    if (!email || !code) { set.status = 400; return { error: 'Email and code required' } }

    const rl = rateLimiters.otp.check(email.toLowerCase().trim())
    if (!rl.allowed) { set.status = 429; return { error: 'Too many attempts, try again later' } }

    const result = await otpService.verifyOtp(email, code)
    if (!result.valid) { set.status = 401; return { error: 'Invalid or expired code' } }

    let user = await userService.findByEmail(email)
    if (!user) {
      user = await userService.createUser({ email })
    }

    if (!user.emailVerifiedAt) {
      await userService.verifyEmail(user.email)
    }

    return sessionService.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
  })

  return app
}

export { otpRoutes }
