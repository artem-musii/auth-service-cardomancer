import { describe, it, expect } from 'bun:test'
import { OtpService } from '../../../src/modules/credentials/otp-service.js'
import { InMemoryOtpStore } from '../../fakes/in-memory-otp-store.js'
import { FakeEventPublisher } from '../../fakes/fake-event-publisher.js'

describe('OtpService', () => {
  const setup = () => {
    const store = InMemoryOtpStore()
    const events = FakeEventPublisher()
    const service = OtpService({ otpStore: store, eventPublisher: events })
    return { service, store, events }
  }

  it('generates a 6-digit OTP and publishes email.send', async () => {
    const { service, store, events } = setup()
    await service.requestOtp('a@b.com')
    const otp = await store.get('a@b.com')
    expect(otp.code).toMatch(/^\d{6}$/)
    expect(events.published[0].type).toBe('email.send')
  })

  it('verifies correct OTP', async () => {
    const { service, store } = setup()
    await service.requestOtp('a@b.com')
    const otp = await store.get('a@b.com')
    const result = await service.verifyOtp('a@b.com', otp.code)
    expect(result.valid).toBe(true)
  })

  it('rejects wrong OTP', async () => {
    const { service } = setup()
    await service.requestOtp('a@b.com')
    const result = await service.verifyOtp('a@b.com', '000000')
    expect(result.valid).toBe(false)
  })

  it('invalidates OTP after 3 failed attempts', async () => {
    const { service, store } = setup()
    await service.requestOtp('a@b.com')
    const otp = await store.get('a@b.com')
    await service.verifyOtp('a@b.com', '000000')
    await service.verifyOtp('a@b.com', '000000')
    await service.verifyOtp('a@b.com', '000000')
    const result = await service.verifyOtp('a@b.com', otp.code)
    expect(result.valid).toBe(false)
  })

  it('enforces cooldown', async () => {
    const { service } = setup()
    await service.requestOtp('a@b.com')
    await expect(service.requestOtp('a@b.com')).rejects.toThrow('cooldown')
  })
})
