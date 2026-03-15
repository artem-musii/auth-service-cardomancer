const validateRoutes = (app, { sessionService, serviceKey, log }) => {
  app.post('/auth/validate', async ({ body, headers, set }) => {
    log.debug('validation attempt')
    if (headers['x-service-key'] !== serviceKey) { log.warn('validation failed: invalid service key'); set.status = 403; return { error: 'Invalid service key' } }
    const { token } = body
    if (!token) { log.warn('validation failed: no token'); return { valid: false } }
    return sessionService.validate(token)
  })

  return app
}

export { validateRoutes }
