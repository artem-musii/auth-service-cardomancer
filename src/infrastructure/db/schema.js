import { pgTable, pgEnum, uuid, varchar, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'

const providerEnum = pgEnum('provider', ['password', 'google', 'apple'])

const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  displayName: varchar('display_name', { length: 255 }).unique(),
  emailVerifiedAt: timestamp('email_verified_at'),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

const authMethods = pgTable(
  'auth_methods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    provider: providerEnum('provider').notNull(),
    providerId: varchar('provider_id', { length: 255 }),
    passwordHash: varchar('password_hash', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('auth_methods_provider_provider_id_idx').on(table.provider, table.providerId),
    index('auth_methods_user_id_idx').on(table.userId),
  ],
)

export { providerEnum, users, authMethods }
