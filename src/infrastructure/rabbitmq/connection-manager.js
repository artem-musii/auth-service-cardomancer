import amqplib from 'amqplib'

const RabbitMQConnectionManager = ({ url, log }) => {
  let connection = null
  let channel = null
  let closed = false
  let reconnectDelay = 1000
  const publishers = []

  const connect = async () => {
    connection = await amqplib.connect(url)
    channel = await connection.createChannel()

    connection.on('error', (err) => {
      if (log) log.error('rabbitmq connection error', { err })
    })
    connection.on('close', () => {
      if (!closed) scheduleReconnect()
    })
    channel.on('error', (err) => {
      if (log) log.error('rabbitmq channel error', { err })
    })
    channel.on('close', () => {
      if (!closed) scheduleReconnect()
    })

    reconnectDelay = 1000
    for (const publisher of publishers) publisher.reset()
    if (log) log.info('rabbitmq connected')
  }

  const scheduleReconnect = () => {
    if (closed) return
    const delay = reconnectDelay
    reconnectDelay = Math.min(reconnectDelay * 2, 30000)
    if (log) log.warn('rabbitmq reconnecting', { delay })
    setTimeout(async () => {
      if (closed) return
      try {
        await connect()
      } catch (err) {
        if (log) log.error('rabbitmq reconnect failed', { err })
        scheduleReconnect()
      }
    }, delay)
  }

  const getChannel = () => channel

  const isConnected = () => channel !== null && connection !== null

  const registerPublisher = (publisher) => {
    publishers.push(publisher)
  }

  const close = async () => {
    closed = true
    try { await channel?.close() } catch {}
    channel = null
    try { await connection?.close() } catch {}
    connection = null
  }

  return { connect, getChannel, isConnected, registerPublisher, close }
}

export { RabbitMQConnectionManager }
