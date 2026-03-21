const FakeEventPublisher = () => {
  const published = []

  const publish = async (event) => {
    published.push(event)
    return true
  }

  return { publish, published }
}

export { FakeEventPublisher }
