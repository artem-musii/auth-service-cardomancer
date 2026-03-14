const REQUIRED = ['DATABASE_URL', 'REDIS_URL', 'RABBITMQ_URL', 'SERVICE_KEY', 'ALLOWED_ORIGINS']

const loadConfig = (env) => {
  for (const key of REQUIRED) {
    if (!env[key]) throw new Error(`Missing required env var: ${key}`)
  }

  return {
    database: { url: env.DATABASE_URL },
    redis: { url: env.REDIS_URL },
    rabbitmq: { url: env.RABBITMQ_URL },
    session: { ttlHours: parseInt(env.SESSION_TTL_HOURS || '168', 10) },
    google: {
      clientId: env.GOOGLE_CLIENT_ID || '',
      clientSecret: env.GOOGLE_CLIENT_SECRET || ''
    },
    apple: {
      clientId: env.APPLE_CLIENT_ID || '',
      teamId: env.APPLE_TEAM_ID || '',
      keyId: env.APPLE_KEY_ID || '',
      privateKeyPath: env.APPLE_PRIVATE_KEY_PATH || ''
    },
    serviceKey: env.SERVICE_KEY,
    allowedOrigins: env.ALLOWED_ORIGINS.split(','),
    port: parseInt(env.PORT || '3001', 10)
  }
}

export { loadConfig }
