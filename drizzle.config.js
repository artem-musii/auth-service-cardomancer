import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/db/schema.js',
  out: './src/infrastructure/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL
  }
})
