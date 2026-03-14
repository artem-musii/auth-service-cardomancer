const createContainer = ({ overrides = {} } = {}) => {
  const factories = new Map()
  const instances = new Map()

  const resolve = (name) => {
    if (name in overrides) return overrides[name]
    if (instances.has(name)) return instances.get(name)
    const factory = factories.get(name)
    if (!factory) throw new Error(`No registration for "${name}"`)
    const instance = factory({ resolve })
    instances.set(name, instance)
    return instance
  }

  const register = (name, factory) => {
    factories.set(name, factory)
  }

  return { resolve, register }
}

export { createContainer }
