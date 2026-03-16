import { describe, it, expect } from 'bun:test'
import { GoogleProvider } from '../../../src/infrastructure/oauth/google-provider.js'

describe('GoogleProvider', () => {
  const config = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'http://localhost:3001/auth/google/callback',
  }

  describe('getAuthUrl', () => {
    it('returns correct Google OAuth URL with all params', () => {
      const provider = GoogleProvider(config)
      const url = new URL(provider.getAuthUrl('test-state'))
      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
      expect(url.searchParams.get('client_id')).toBe('test-client-id')
      expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3001/auth/google/callback')
      expect(url.searchParams.get('state')).toBe('test-state')
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('scope')).toBe('email profile')
      expect(url.searchParams.get('access_type')).toBe('offline')
      expect(url.searchParams.get('prompt')).toBe('consent')
    })
  })

  describe('exchangeCode', () => {
    it('exchanges code and returns user info', async () => {
      const fetchFn = async (url, opts) => {
        if (url === 'https://oauth2.googleapis.com/token') {
          const body = new URLSearchParams(opts.body)
          expect(body.get('code')).toBe('auth-code')
          expect(body.get('client_id')).toBe('test-client-id')
          expect(body.get('client_secret')).toBe('test-client-secret')
          expect(body.get('grant_type')).toBe('authorization_code')
          return { ok: true, json: async () => ({ access_token: 'access-tok' }) }
        }
        if (url === 'https://www.googleapis.com/oauth2/v2/userinfo') {
          expect(opts.headers.Authorization).toBe('Bearer access-tok')
          return { ok: true, json: async () => ({ id: 'g-123', email: 'user@gmail.com', name: 'Test User' }) }
        }
      }
      const provider = GoogleProvider({ ...config, fetchFn })
      const result = await provider.exchangeCode('auth-code')
      expect(result.email).toBe('user@gmail.com')
      expect(result.displayName).toBe('Test User')
      expect(result.providerId).toBe('g-123')
    })

    it('throws on failed token exchange', async () => {
      const fetchFn = async () => ({ ok: false, json: async () => ({ error: 'invalid_grant' }) })
      const provider = GoogleProvider({ ...config, fetchFn })
      await expect(provider.exchangeCode('bad-code')).rejects.toThrow('token exchange failed')
    })

    it('throws on failed userinfo fetch', async () => {
      const fetchFn = async (url) => {
        if (url === 'https://oauth2.googleapis.com/token') {
          return { ok: true, json: async () => ({ access_token: 'tok' }) }
        }
        return { ok: false, json: async () => ({ error: 'unauthorized' }) }
      }
      const provider = GoogleProvider({ ...config, fetchFn })
      await expect(provider.exchangeCode('code')).rejects.toThrow('userinfo fetch failed')
    })
  })
})
