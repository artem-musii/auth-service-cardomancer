const DISPLAY_NAME_REGEX = /^[a-z0-9_]{5,32}$/

const validateDisplayName = (name) => DISPLAY_NAME_REGEX.test(name)

export { validateDisplayName }
