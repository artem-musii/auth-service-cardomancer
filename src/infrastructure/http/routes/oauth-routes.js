const oauthRoutes = (app, { oauthService }) => {
  app.get('/auth/google', ({ set }) => {
    const state = crypto.randomUUID()
    set.redirect = oauthService.getAuthUrl('google', state)
  })

  app.get('/auth/google/callback', async ({ query, set }) => {
    const { code } = query
    if (!code) { set.status = 400; return { error: 'Missing code' } }
    try {
      return await oauthService.handleCallback('google', code)
    } catch (e) {
      set.status = 401; return { error: e.message }
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
      return await oauthService.handleCallback('apple', code)
    } catch (e) {
      set.status = 401; return { error: e.message }
    }
  })

  return app
}

export { oauthRoutes }
