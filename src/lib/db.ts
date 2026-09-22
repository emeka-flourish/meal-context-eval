import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaNeon } from '@prisma/adapter-neon'

// Placeholder keeps module-load safe without env (tests, CI); Prisma only
// connects on first query, which will then fail loudly if truly unset.
const connectionString = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/meal_context_eval'

function makeClient() {
  // Neon serverless driver in prod; node-postgres for local dev.
  const adapter = connectionString.includes('neon.tech')
    ? new PrismaNeon({ connectionString })
    : new PrismaPg({ connectionString })
  return new PrismaClient({ adapter })
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const db = globalForPrisma.prisma ?? makeClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
