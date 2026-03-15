const oauthRoutes = (app, { oauthService, userService, clientUrl }) => {
  app.get('/auth/google', ({ set }) => {
    const state = crypto.randomUUID()
    set.redirect = oauthService.getAuthUrl('google', state)
  })

  app.get('/auth/google/callback', async ({ query, set }) => {
    const { code } = query
    if (!code) { set.status = 400; return { error: 'Missing code' } }
    try {
      const session = await oauthService.handleCallback('google', code)
      const user = await userService.findById(session.userId)
      const params = new URLSearchParams({
        oauth_token: session.token,
        oauth_userId: session.userId,
        oauth_expiresAt: session.expiresAt.toISOString()
      })
      if (session.displayName) params.set('oauth_displayName', session.displayName)
      if (!user?.displayName) params.set('oauth_needsDisplayName', 'true')
      set.redirect = `${clientUrl}?${params.toString()}`
    } catch (e) {
      set.redirect = `${clientUrl}?oauth_error=${encodeURIComponent(e.message)}`
    }
  })

  app.get('/auth/apple', ({ set }) => {
    const state = crypto.randomUUID()
    set.redirect = oauthService.getAuthUrl('apple', state)
  })

  app.get('/auth/apple/callback', async ({ query, body: reqBody, set }) => {
    const code = query?.code || reqBody?.code
    if (!code) { set.status = 400; return { error: 'Missing code' } }
    try {
      const session = await oauthService.handleCallback('apple', code)
      const user = await userService.findById(session.userId)
      const params = new URLSearchParams({
        oauth_token: session.token,
        oauth_userId: session.userId,
        oauth_expiresAt: session.expiresAt.toISOString()
      })
      if (session.displayName) params.set('oauth_displayName', session.displayName)
      if (!user?.displayName) params.set('oauth_needsDisplayName', 'true')
      set.redirect = `${clientUrl}?${params.toString()}`
    } catch (e) {
      set.redirect = `${clientUrl}?oauth_error=${encodeURIComponent(e.message)}`
    }
  })

  return app
}

export { oauthRoutes }
