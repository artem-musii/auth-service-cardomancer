import { t } from 'elysia'
import { maskEmail } from '../../../shared/utils.js'

const otpRoutes = (app, { otpService, userService, sessionService, rateLimiters, userRepository, passwordService, log }) => {
  app.post('/auth/otp/request', async ({ body, set }) => {
    const { email } = body

    log.debug('otp request attempt', { email: maskEmail(email) })

    const rl = await rateLimiters['otp-request'].check(email.toLowerCase().trim())
    if (!rl.allowed) {
      log.warn('otp request rate limit hit', { email: maskEmail(email) })
      set.status = 429
      set.headers['Retry-After'] = String(Math.ceil(rl.retryAfterMs / 1000))
      return { error: 'Too many attempts, try again later' }
    }

    try {
      await otpService.requestOtp(email)
      log.info('otp sent', { email: maskEmail(email) })
      return { ok: true }
    } catch (e) {
      log.error('otp request failed', { email: maskEmail(email), error: e.message })
      set.status = 429; return { error: e.message }
    }
  }, { body: t.Object({ email: t.String({ format: 'email' }) }) })

  app.post('/auth/otp/verify', async ({ body, set }) => {
    const { email, code } = body

    log.debug('otp verify attempt', { email: maskEmail(email) })

    const rl = await rateLimiters['otp-verify'].check(email.toLowerCase().trim())
    if (!rl.allowed) {
      log.warn('otp verify rate limit hit', { email: maskEmail(email) })
      set.status = 429
      set.headers['Retry-After'] = String(Math.ceil(rl.retryAfterMs / 1000))
      return { error: 'Too many attempts, try again later' }
    }

    const result = await otpService.verifyOtp(email, code)
    if (!result.valid) { log.warn('invalid otp', { email: maskEmail(email) }); set.status = 401; return { error: 'Invalid or expired code' } }

    let user = await userService.findByEmail(email)
    if (!user) {
      user = await userService.createUser({ email })
    }

    if (!user.emailVerifiedAt) {
      await userService.verifyEmail(user.email)
    }

    const pendingHash = await otpService.getPendingPassword(email)
    if (pendingHash) {
      const methods = await userRepository.findAuthMethodsByUserId(user.id)
      const pwMethod = methods.find((m) => m.provider === 'password')
      if (!pwMethod) {
        await userRepository.createAuthMethod({ userId: user.id, provider: 'password', providerId: email.toLowerCase().trim(), passwordHash: pendingHash })
        log.info('password auth method created from pending login', { email: maskEmail(email) })
      }
    }

    log.info('otp verified successfully', { email: maskEmail(email) })
    const session = await sessionService.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
    if (!user.displayName) session.needsDisplayName = true
    return session
  }, { body: t.Object({ email: t.String({ format: 'email' }), code: t.String({ minLength: 6, maxLength: 6 }) }) })

  return app
}

export { otpRoutes }
