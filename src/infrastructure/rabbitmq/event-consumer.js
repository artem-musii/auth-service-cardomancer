const EXCHANGE = 'email.events'
const QUEUE = 'auth-service.email.events'

const RabbitMQConsumer = (channel, { onEmailSent, onEmailFailed }) => {
  const start = async () => {
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true })
    await channel.assertQueue(QUEUE, { durable: true })
    await channel.bindQueue(QUEUE, EXCHANGE, 'email.sent')
    await channel.bindQueue(QUEUE, EXCHANGE, 'email.failed')

    channel.consume(QUEUE, async (msg) => {
      if (!msg) return
      try {
        const event = JSON.parse(msg.content.toString())
        switch (event.type) {
          case 'email.sent': await onEmailSent?.(event.payload); break
          case 'email.failed': await onEmailFailed?.(event.payload); break
        }
        channel.ack(msg)
      } catch (e) {
        channel.nack(msg, false, false)
      }
    })
  }

  return { start }
}

export { RabbitMQConsumer }
