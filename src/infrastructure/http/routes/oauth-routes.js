const buildRedirectUrl = (clientUrl, session, user) => {
  const params = new URLSearchParams({
    oauth_token: session.token,
    oauth_userId: session.userId,
    oauth_expiresAt: session.expiresAt.toISOString()
  })
  if (session.displayName) params.set('oauth_displayName', session.displayName)
  if (!user?.displayName) params.set('oauth_needsDisplayName', 'true')
  return `${clientUrl}?${params.toString()}`
}

const oauthRoutes = (app, { oauthService, userService, clientUrl }) => {
  app.get('/auth/google', () => {
    const state = crypto.randomUUID()
    return Response.redirect(oauthService.getAuthUrl('google', state), 302)
  })

  app.get('/auth/google/callback', async ({ query }) => {
    const { code } = query
    if (!code) return new Response('Missing code', { status: 400 })
    try {
      const session = await oauthService.handleCallback('google', code)
      const user = await userService.findById(session.userId)
      return Response.redirect(buildRedirectUrl(clientUrl, session, user), 302)
    } catch (e) {
      return Response.redirect(`${clientUrl}?oauth_error=${encodeURIComponent(e.message)}`, 302)
    }
  })

  app.get('/auth/apple', () => {
    const state = crypto.randomUUID()
    return Response.redirect(oauthService.getAuthUrl('apple', state), 302)
  })

  app.get('/auth/apple/callback', async ({ query, body: reqBody }) => {
    const code = query?.code || reqBody?.code
    if (!code) return new Response('Missing code', { status: 400 })
    try {
      const session = await oauthService.handleCallback('apple', code)
      const user = await userService.findById(session.userId)
      return Response.redirect(buildRedirectUrl(clientUrl, session, user), 302)
    } catch (e) {
      return Response.redirect(`${clientUrl}?oauth_error=${encodeURIComponent(e.message)}`, 302)
    }
  })

  return app
}

export { oauthRoutes }
