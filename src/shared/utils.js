import { timingSafeEqual, createHmac } from 'crypto'

export function maskEmail(email) {
  const [local, domain] = email.split('@')
  const visible = local.slice(0, Math.min(3, local.length))
  return `${visible}***@${domain}`
}

export function extractBearerToken(header) {
  if (header == null) return null
  if (!header.startsWith('Bearer ')) return null
  const token = header.slice(7)
  if (token === '') return null
  return token
}

export function secureCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const hashA = createHmac('sha256', 'compare').update(a).digest()
  const hashB = createHmac('sha256', 'compare').update(b).digest()
  return timingSafeEqual(hashA, hashB)
}
