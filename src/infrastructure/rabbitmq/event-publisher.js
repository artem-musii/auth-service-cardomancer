const EXCHANGE = 'auth.events'

const RabbitMQPublisher = (channel) => {
  let ready = false

  const init = async () => {
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true })
    ready = true
  }

  const publish = async (event) => {
    if (!ready) await init()
    const routingKey = event.type
    const message = Buffer.from(JSON.stringify(event))
    channel.publish(EXCHANGE, routingKey, message, { persistent: true })
  }

  return { publish, init }
}

export { RabbitMQPublisher }
