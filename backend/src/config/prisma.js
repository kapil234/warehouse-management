import prismaPackage from '@prisma/client';

const { PrismaClient } = prismaPackage;

// Reuse a single Prisma instance across the app (important in dev with hot-reload,
// where re-importing this file shouldn't open a new DB connection each time)
const prisma =
  global.prisma ||
  new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
if (process.env.NODE_ENV !== 'production') global.prisma = prisma;

// Print any database query slower than SLOW_QUERY_MS (default 500ms) so it is
// easy to see what is making a page slow. Only the SQL text is printed - never
// the parameter values. Set SLOW_QUERY_MS=0 to turn this off.
const SLOW_QUERY_MS = process.env.SLOW_QUERY_MS === undefined ? 500 : Number(process.env.SLOW_QUERY_MS);
if (SLOW_QUERY_MS > 0 && typeof prisma.$on === 'function' && !prisma.__slowQueryLogging) {
  prisma.__slowQueryLogging = true;
  prisma.$on('query', (e) => {
    if (e.duration >= SLOW_QUERY_MS) {
      console.warn(`[slow query] ${e.duration}ms ${String(e.query).replace(/\s+/g, ' ').slice(0, 220)}`);
    }
  });
}

export default prisma;
