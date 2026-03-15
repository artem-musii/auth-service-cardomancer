const maskEmail = (email) => {
  const [local, domain] = email.split('@')
  return `${local.slice(0, 3)}***@${domain}`
}

const otpRoutes = (app, { otpService, userService, sessionService, rateLimiters, userRepository, log }) => {
  app.post('/auth/otp/request', async ({ body, set }) => {
    const { email } = body
    if (!email) { set.status = 400; return { error: 'Email required' } }

    log.debug('otp request attempt', { email: maskEmail(email) })

    const rl = rateLimiters.otp.check(email.toLowerCase().trim())
    if (!rl.allowed) { log.warn('otp request rate limit hit', { email: maskEmail(email) }); set.status = 429; return { error: 'Too many attempts, try again later' } }

    try {
      await otpService.requestOtp(email)
      log.info('otp sent', { email: maskEmail(email) })
      return { ok: true }
    } catch (e) {
      log.error('otp request failed', { email: maskEmail(email), error: e.message })
      set.status = 429; return { error: e.message }
    }
  })

  app.post('/auth/otp/verify', async ({ body, set }) => {
    const { email, code } = body
    if (!email || !code) { set.status = 400; return { error: 'Email and code required' } }

    log.debug('otp verify attempt', { email: maskEmail(email) })

    const rl = rateLimiters.otp.check(email.toLowerCase().trim())
    if (!rl.allowed) { log.warn('otp verify rate limit hit', { email: maskEmail(email) }); set.status = 429; return { error: 'Too many attempts, try again later' } }

    const result = await otpService.verifyOtp(email, code)
    if (!result.valid) { log.warn('invalid otp', { email: maskEmail(email) }); set.status = 401; return { error: 'Invalid or expired code' } }

    let user = await userService.findByEmail(email)
    if (!user) {
      user = await userService.createUser({ email })
    }

    if (!user.emailVerifiedAt) {
      await userService.verifyEmail(user.email)
    }

    log.info('otp verified successfully', { email: maskEmail(email) })
    return sessionService.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
  })

  return app
}

export { otpRoutes }
