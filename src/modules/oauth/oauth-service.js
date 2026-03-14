const OAuthService = ({ userService, sessionService, userRepository, providers }) => {
  const getAuthUrl = (providerName, state) => {
    const provider = providers[providerName]
    if (!provider) throw new Error(`Unknown OAuth provider: ${providerName}`)
    return provider.getAuthUrl(state)
  }

  const handleCallback = async (providerName, code) => {
    const provider = providers[providerName]
    if (!provider) throw new Error(`Unknown OAuth provider: ${providerName}`)

    const info = await provider.exchangeCode(code)
    let authMethod = await userRepository.findAuthMethod(providerName, info.providerId)

    if (authMethod) {
      const user = await userService.findById(authMethod.userId)
      return sessionService.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
    }

    let user = await userService.findByEmail(info.email)
    if (!user) {
      user = await userService.createUser({ email: info.email, displayName: info.displayName })
    }

    await userRepository.createAuthMethod({
      userId: user.id,
      provider: providerName,
      providerId: info.providerId
    })

    return sessionService.createSession({ userId: user.id, email: user.email, displayName: user.displayName })
  }

  return { getAuthUrl, handleCallback }
}

export { OAuthService }
