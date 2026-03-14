const validateRoutes = (app, { sessionService, serviceKey }) => {
  app.post('/auth/validate', async ({ body, headers, set }) => {
    if (headers['x-service-key'] !== serviceKey) { set.status = 403; return { error: 'Invalid service key' } }
    const { token } = body
    if (!token) return { valid: false }
    return sessionService.validate(token)
  })

  return app
}

export { validateRoutes }
