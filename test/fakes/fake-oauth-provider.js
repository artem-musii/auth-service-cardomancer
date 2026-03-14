const FakeOAuthProvider = ({ userInfo = { providerId: 'g123', email: 'oauth@test.com', displayName: 'OAuth User' } } = {}) => {
  const getAuthUrl = (state) => `https://fake-oauth.com/auth?state=${state}`
  const exchangeCode = async (_code) => userInfo
  return { getAuthUrl, exchangeCode }
}

export { FakeOAuthProvider }
