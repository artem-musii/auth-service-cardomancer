import { pgTable, pgEnum, uuid, varchar, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'

const providerEnum = pgEnum('provider', ['password', 'google', 'apple'])

const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  displayName: varchar('display_name', { length: 255 }),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

const authMethods = pgTable('auth_methods', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  provider: providerEnum('provider').notNull(),
  providerId: varchar('provider_id', { length: 255 }),
  passwordHash: varchar('password_hash', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => [
  uniqueIndex('auth_methods_provider_provider_id_idx').on(table.provider, table.providerId),
  index('auth_methods_user_id_idx').on(table.userId)
])

const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  token: varchar('token', { length: 64 }).notNull().unique(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at')
}, (table) => [
  index('sessions_user_id_idx').on(table.userId)
])

export { providerEnum, users, authMethods, sessions }
