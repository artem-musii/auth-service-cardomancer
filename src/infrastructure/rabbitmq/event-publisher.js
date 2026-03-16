const RabbitMQPublisher = (connectionManager, { exchange = 'auth.events', type = 'topic', log } = {}) => {
  let ready = false

  const reset = () => {
    ready = false
  }

  connectionManager.registerPublisher({ reset })

  const init = async () => {
    const channel = connectionManager.getChannel()
    if (!channel) return false
    await channel.assertExchange(exchange, type, { durable: true })
    ready = true
    if (log) log.info('exchange initialized', { exchange })
    return true
  }

  const publish = async (event) => {
    if (!ready) {
      const ok = await init()
      if (!ok) {
        if (log) log.warn('rabbitmq not connected, event dropped', { type: event.type })
        return false
      }
    }
    const channel = connectionManager.getChannel()
    if (!channel) {
      ready = false
      return false
    }
    const routingKey = event.type
    const message = Buffer.from(JSON.stringify(event))
    channel.publish(exchange, routingKey, message, { persistent: true })
    if (log) log.debug('event published', { exchange, type: event.type })
    return true
  }

  return { publish, init, reset }
}

export { RabbitMQPublisher }
