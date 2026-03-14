const startTime = Date.now()

const healthRoutes = (app) => {
  app.get('/health', () => ({
    status: 'ok',
    service: 'auth-service',
    uptime: Math.floor((Date.now() - startTime) / 1000)
  }))

  return app
}

export { healthRoutes }
