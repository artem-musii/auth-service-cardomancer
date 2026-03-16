import { describe, it, expect } from 'bun:test'
import { loadConfig } from '../../src/config.js'

describe('loadConfig', () => {
  it('returns config from env object', () => {
    const env = {
      DATABASE_URL: 'postgres://localhost/test',
      REDIS_URL: 'redis://localhost',
      RABBITMQ_URL: 'amqp://localhost',
      SESSION_TTL_HOURS: '24',
      SERVICE_KEY: 'key',
      ALLOWED_ORIGINS: 'http://localhost:8000',
      CLIENT_URL: 'http://localhost:8000',
      PORT: '3001'
    }
    const config = loadConfig(env)
    expect(config.database.url).toBe('postgres://localhost/test')
    expect(config.session.ttlHours).toBe(24)
    expect(config.port).toBe(3001)
  })

  it('throws on missing required field', () => {
    expect(() => loadConfig({})).toThrow()
  })

  it('throws on missing CLIENT_URL', () => {
    const env = {
      DATABASE_URL: 'postgres://localhost/test',
      REDIS_URL: 'redis://localhost',
      RABBITMQ_URL: 'amqp://localhost',
      SERVICE_KEY: 'key',
      ALLOWED_ORIGINS: 'http://localhost:8000'
    }
    expect(() => loadConfig(env)).toThrow('Missing required env var: CLIENT_URL')
  })

  it('uses defaults for optional fields', () => {
    const env = {
      DATABASE_URL: 'postgres://localhost/test',
      REDIS_URL: 'redis://localhost',
      RABBITMQ_URL: 'amqp://localhost',
      SERVICE_KEY: 'key',
      ALLOWED_ORIGINS: 'http://localhost:8000',
      CLIENT_URL: 'http://localhost:8000'
    }
    const config = loadConfig(env)
    expect(config.session.ttlHours).toBe(168)
    expect(config.port).toBe(3001)
  })
})
