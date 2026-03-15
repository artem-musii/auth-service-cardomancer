const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }

const createLogger = (service, level = 'info') => {
  const threshold = LEVELS[level] ?? LEVELS.info

  const log = (lvl, msg, data) => {
    if (LEVELS[lvl] < threshold) return
    const entry = { time: new Date().toISOString(), level: lvl, service, msg }
    if (data !== undefined) entry.data = data
    const method = lvl === 'error' ? 'error' : lvl === 'warn' ? 'warn' : 'log'
    console[method](JSON.stringify(entry))
  }

  return {
    debug: (msg, data) => log('debug', msg, data),
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),
  }
}

export { createLogger }
