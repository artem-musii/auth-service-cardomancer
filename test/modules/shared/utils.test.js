import { describe, it, expect } from 'bun:test'
import { maskEmail, extractBearerToken, secureCompare } from '../../../src/shared/utils.js'

describe('maskEmail', () => {
  it('masks local part longer than 3 chars', () => {
    expect(maskEmail('hello@example.com')).toBe('hel***@example.com')
  })

  it('masks local part exactly 3 chars', () => {
    expect(maskEmail('abc@example.com')).toBe('abc***@example.com')
  })

  it('masks short local part of 2 chars', () => {
    expect(maskEmail('ab@example.com')).toBe('ab***@example.com')
  })

  it('masks single char local part', () => {
    expect(maskEmail('a@example.com')).toBe('a***@example.com')
  })

  it('preserves the domain', () => {
    expect(maskEmail('user@sub.domain.org')).toBe('use***@sub.domain.org')
  })

  it('handles long local part', () => {
    expect(maskEmail('verylongname@test.com')).toBe('ver***@test.com')
  })
})

describe('extractBearerToken', () => {
  it('returns null for null header', () => {
    expect(extractBearerToken(null)).toBeNull()
  })

  it('returns null for undefined header', () => {
    expect(extractBearerToken(undefined)).toBeNull()
  })

  it('returns null when header does not start with Bearer ', () => {
    expect(extractBearerToken('Token abc123')).toBeNull()
  })

  it('returns null when header is just "Bearer "', () => {
    expect(extractBearerToken('Bearer ')).toBeNull()
  })

  it('returns null for empty string header', () => {
    expect(extractBearerToken('')).toBeNull()
  })

  it('returns the token string for valid Bearer header', () => {
    expect(extractBearerToken('Bearer mytoken123')).toBe('mytoken123')
  })

  it('returns the full token including dots and hyphens', () => {
    expect(extractBearerToken('Bearer eyJ.abc-def')).toBe('eyJ.abc-def')
  })

  it('returns null when prefix is lowercase bearer', () => {
    expect(extractBearerToken('bearer mytoken')).toBeNull()
  })
})

describe('secureCompare', () => {
  it('returns true for equal strings', () => {
    expect(secureCompare('abc', 'abc')).toBe(true)
  })

  it('returns false for different strings of same length', () => {
    expect(secureCompare('abc', 'xyz')).toBe(false)
  })

  it('returns false for different length strings', () => {
    expect(secureCompare('abc', 'abcd')).toBe(false)
  })

  it('returns false when first arg is not a string', () => {
    expect(secureCompare(123, 'abc')).toBe(false)
  })

  it('returns false when second arg is not a string', () => {
    expect(secureCompare('abc', null)).toBe(false)
  })

  it('returns false when both args are non-strings', () => {
    expect(secureCompare(null, null)).toBe(false)
  })

  it('returns true for empty strings', () => {
    expect(secureCompare('', '')).toBe(true)
  })

  it('returns false for empty vs non-empty', () => {
    expect(secureCompare('', 'a')).toBe(false)
  })
})
