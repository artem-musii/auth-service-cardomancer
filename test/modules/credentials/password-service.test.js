import { describe, it, expect } from 'bun:test'
import { PasswordService } from '../../../src/modules/credentials/password-service.js'

describe('PasswordService', () => {
  const service = PasswordService()

  it('hashes and verifies a password', async () => {
    const hash = await service.hash('myPassword123')
    expect(hash).not.toBe('myPassword123')
    expect(await service.verify('myPassword123', hash)).toBe(true)
  })

  it('rejects wrong password', async () => {
    const hash = await service.hash('correct')
    expect(await service.verify('wrong', hash)).toBe(false)
  })
})
