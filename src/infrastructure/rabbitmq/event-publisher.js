const RabbitMQPublisher = (channel, { exchange = 'auth.events', type = 'topic', log } = {}) => {
  let ready = false

  const init = async () => {
    await channel.assertExchange(exchange, type, { durable: true })
    ready = true
    if (log) log.info('exchange initialized', { exchange })
  }

  const publish = async (event) => {
    if (!ready) await init()
    const routingKey = event.type
    const message = Buffer.from(JSON.stringify(event))
    channel.publish(exchange, routingKey, message, { persistent: true })
    if (log) log.debug('event published', { exchange, type: event.type })
  }

  return { publish, init }
}

export { RabbitMQPublisher }
