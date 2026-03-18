import { sql } from 'drizzle-orm'

const startTime = Date.now()
const HEALTH_TIMEOUT = 3000

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])

const healthRoutes = (app, { db, redis, rabbitManager }) => {
  app.get('/health', async ({ set }) => {
    const checks = { database: 'ok', redis: 'ok', rabbitmq: 'ok' }

    if (db) {
      try {
        await withTimeout(db.execute(sql`SELECT 1`), HEALTH_TIMEOUT)
      } catch {
        checks.database = 'failing'
      }
    } else {
      checks.database = 'skipped'
    }

    if (redis) {
      try {
        await withTimeout(redis.ping(), HEALTH_TIMEOUT)
      } catch {
        checks.redis = 'failing'
      }
    } else {
      checks.redis = 'skipped'
    }

    if (rabbitManager) {
      checks.rabbitmq = rabbitManager.isConnected() ? 'ok' : 'failing'
    } else {
      checks.rabbitmq = 'skipped'
    }

    const critical = checks.database !== 'failing' && checks.redis !== 'failing'
    const allHealthy = critical && checks.rabbitmq !== 'failing'
    if (!critical) set.status = 503

    return {
      status: allHealthy ? 'ok' : critical ? 'degraded' : 'unhealthy',
      service: 'auth-service',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      checks,
    }
  })

  return app
}

export { healthRoutes }
