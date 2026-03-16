const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const GoogleProvider = ({ clientId, clientSecret, redirectUri, fetchFn = fetch }) => {
  const getAuthUrl = (state) => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: 'email profile',
      access_type: 'offline',
      prompt: 'consent',
    })
    return `${GOOGLE_AUTH_URL}?${params.toString()}`
  }

  const exchangeCode = async (code) => {
    const tokenRes = await fetchFn(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })
    if (!tokenRes.ok) throw new Error('Google OAuth token exchange failed')
    const { access_token } = await tokenRes.json()

    const userRes = await fetchFn(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    if (!userRes.ok) throw new Error('Google OAuth userinfo fetch failed')
    const { id, email, name } = await userRes.json()

    return { email, displayName: name, providerId: id }
  }

  return { getAuthUrl, exchangeCode }
}

export { GoogleProvider }
