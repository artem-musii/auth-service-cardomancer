const otpRoutes = (app, { otpService, userService, sessionService }) => {
  app.post('/auth/otp/request', async ({ body, set }) => {
    const { email } = body
    if (!email) { set.status = 400; return { error: 'Email required' } }

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

    const result = await otpService.verifyOtp(email, code)
    if (!result.valid) { set.status = 401; return { error: 'Invalid or expired code' } }

    let user = await userService.findByEmail(email)
    if (!user) {
      user = await userService.createUser({ email })
    }

    return sessionService.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
  })

  return app
}

export { otpRoutes }
