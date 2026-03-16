import { t } from 'elysia'

const oauthExchangeRoute = (app, { redis, log }) => {
  app.post('/auth/oauth/exchange', async ({ body, set }) => {
    const { code } = body
    const key = `oauth-code:${code}`
    const raw = await redis.get(key)
    if (!raw) {
      set.status = 401
      return { error: 'Invalid or expired code' }
    }
    await redis.del(key)
    const session = JSON.parse(raw)
    if (log) log.info('oauth code exchanged', { userId: session.userId })
    return session
  }, {
    body: t.Object({
      code: t.String({ minLength: 36, maxLength: 36 }),
    }),
  })

  return app
}

export { oauthExchangeRoute }
