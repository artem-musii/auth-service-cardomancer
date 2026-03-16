const STATE_TTL = 300
const STATE_PREFIX = 'oauth-state:'

const oauthRoutes = (app, { oauthService, redis, clientUrl }) => {
  app.get('/auth/google', async () => {
    const state = crypto.randomUUID()
    await redis.set(STATE_PREFIX + state, '1', 'EX', STATE_TTL)
    return Response.redirect(oauthService.getAuthUrl('google', state), 302)
  })

  app.get('/auth/google/callback', async ({ query }) => {
    const { code, state } = query
    if (!code) return new Response('Missing code', { status: 400 })

    if (!state) {
      return Response.redirect(`${clientUrl}?oauth_error=${encodeURIComponent('Missing state parameter')}`, 302)
    }
    const storedState = await redis.get(STATE_PREFIX + state)
    if (!storedState) {
      return Response.redirect(`${clientUrl}?oauth_error=${encodeURIComponent('Invalid or expired state')}`, 302)
    }
    await redis.del(STATE_PREFIX + state)

    try {
      const result = await oauthService.handleCallback('google', code)
      const authCode = crypto.randomUUID()
      await redis.set(`oauth-code:${authCode}`, JSON.stringify(result), 'EX', 30)
      return Response.redirect(`${clientUrl}?code=${authCode}`, 302)
    } catch (e) {
      return Response.redirect(`${clientUrl}?oauth_error=${encodeURIComponent(e.message)}`, 302)
    }
  })

  return app
}

export { oauthRoutes }
