import { describe, it, expect } from 'bun:test'
import { validateDisplayName } from '../../../src/modules/identity/display-name.js'

describe('validateDisplayName', () => {
  it('accepts valid usernames', () => {
    expect(validateDisplayName('hello_world')).toBe(true)
    expect(validateDisplayName('user123')).toBe(true)
    expect(validateDisplayName('a_b_c_d_e')).toBe(true)
    expect(validateDisplayName('abcde')).toBe(true)
    expect(validateDisplayName('a'.repeat(32))).toBe(true)
  })

  it('rejects too short', () => {
    expect(validateDisplayName('ab')).toBe(false)
    expect(validateDisplayName('four')).toBe(false)
    expect(validateDisplayName('')).toBe(false)
  })

  it('rejects too long', () => {
    expect(validateDisplayName('a'.repeat(33))).toBe(false)
  })

  it('rejects uppercase', () => {
    expect(validateDisplayName('Hello')).toBe(false)
    expect(validateDisplayName('UPPER')).toBe(false)
  })

  it('rejects special chars and spaces', () => {
    expect(validateDisplayName('user@name')).toBe(false)
    expect(validateDisplayName('user name')).toBe(false)
    expect(validateDisplayName('user-name')).toBe(false)
    expect(validateDisplayName('user.name')).toBe(false)
    expect(validateDisplayName('<script>')).toBe(false)
  })
})
