const OAuthService = ({ userService, sessionService, userRepository, providers, emailPublisher, log }) => {
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
      let user = await userService.findById(authMethod.userId)
      if (!user.emailVerifiedAt) {
        user = await userService.verifyEmail(user.email)
      }
      const session = await sessionService.createSession({
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
      })

      try {
        await emailPublisher.publish({
          id: crypto.randomUUID(),
          type: 'email.send',
          timestamp: new Date().toISOString(),
          payload: {
            to: user.email,
            subject: 'New sign-in to your account',
            fromName: 'Cardomancer',
            template: 'login-success',
            variables: {
              name: user.displayName || 'there',
              email: user.email,
              loginTime: new Date().toISOString(),
            },
          },
        })
      } catch (_e) {
        if (log) log.warn('failed to publish login-success email for oauth', { email: user.email })
      }

      return session
    }

    let isNewUser = false
    let user = await userService.findByEmail(info.email)
    if (!user) {
      user = await userService.createUser({ email: info.email })
      isNewUser = true
    }

    if (!user.emailVerifiedAt) {
      user = await userService.verifyEmail(user.email)
    }

    await userRepository.createAuthMethod({
      userId: user.id,
      provider: providerName,
      providerId: info.providerId,
    })

    const session = await sessionService.createSession({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
    })

    if (isNewUser) {
      try {
        await emailPublisher.publish({
          id: crypto.randomUUID(),
          type: 'email.send',
          timestamp: new Date().toISOString(),
          payload: {
            to: user.email,
            subject: 'Welcome to Cardomancer',
            fromName: 'Cardomancer',
            template: 'welcome',
            variables: { name: user.displayName || 'there', email: user.email },
          },
        })
      } catch (_e) {
        if (log) log.warn('failed to publish welcome email for oauth', { email: user.email })
      }
    }

    try {
      await emailPublisher.publish({
        id: crypto.randomUUID(),
        type: 'email.send',
        timestamp: new Date().toISOString(),
        payload: {
          to: user.email,
          subject: 'New sign-in to your account',
          fromName: 'Cardomancer',
          template: 'login-success',
          variables: {
            name: user.displayName || 'there',
            email: user.email,
            loginTime: new Date().toISOString(),
          },
        },
      })
    } catch (_e) {
      if (log) log.warn('failed to publish login-success email for oauth', { email: user.email })
    }

    return session
  }

  return { getAuthUrl, handleCallback }
}

export { OAuthService }
