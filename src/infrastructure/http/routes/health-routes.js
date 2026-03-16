import { sql } from 'drizzle-orm'

const startTime = Date.now()
const HEALTH_TIMEOUT = 3000

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])

const healthRoutes = (app, { db, redis }) => {
  app.get('/health', async ({ set }) => {
    const checks = { database: 'ok', redis: 'ok' }

    try {
      await withTimeout(db.execute(sql`SELECT 1`), HEALTH_TIMEOUT)
    } catch {
      checks.database = 'failing'
    }

    try {
      await withTimeout(redis.ping(), HEALTH_TIMEOUT)
    } catch {
      checks.redis = 'failing'
    }

    const healthy = checks.database === 'ok' && checks.redis === 'ok'
    if (!healthy) set.status = 503

    return {
      status: healthy ? 'ok' : 'degraded',
      service: 'auth-service',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      checks,
    }
  })

  return app
}

export { healthRoutes }
