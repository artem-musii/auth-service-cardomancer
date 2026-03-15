const generateCode = () => String(Math.floor(100000 + Math.random() * 900000))

const OTP_TTL = 300
const COOLDOWN_TTL = 60

const maskEmail = (email) => {
  const [local, domain] = email.split('@')
  return `${local.slice(0, 3)}***@${domain}`
}

const OtpService = ({ otpStore, emailPublisher, log }) => {
  const requestOtp = async (email) => {
    const onCooldown = await otpStore.getCooldown(email)
    if (onCooldown) {
      if (log) log.warn('otp cooldown hit', { email: maskEmail(email) })
      throw new Error('OTP cooldown: try again later')
    }

    await otpStore.delete(email)
    const code = generateCode()
    await otpStore.set(email, code, OTP_TTL)
    await otpStore.setCooldown(email, COOLDOWN_TTL)
    if (log) log.debug('otp generated', { email: maskEmail(email) })

    await emailPublisher.publish({
      id: crypto.randomUUID(),
      type: 'email.send',
      timestamp: new Date().toISOString(),
      payload: { to: email, template: 'otp-code', variables: { code } }
    })
    if (log) log.debug('otp email event published', { email: maskEmail(email) })
  }

  const verifyOtp = async (email, code) => {
    const otp = await otpStore.get(email)
    if (!otp) return { valid: false }

    if (otp.code === code) {
      await otpStore.delete(email)
      return { valid: true }
    }

    await otpStore.decrementAttempts(email)
    return { valid: false }
  }

  return { requestOtp, verifyOtp }
}

export { OtpService }
