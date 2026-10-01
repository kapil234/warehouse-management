import prismaPackage from '@prisma/client';
 
const { PrismaClient } = prismaPackage;
 
// Reuse a single Prisma instance across the app (important in dev with hot-reload,
// where re-importing this file shouldn't open a new DB connection each time)
const prisma =
  global.prisma ||
  new PrismaClient({
    // Default is maxWait 2000ms / timeout 5000ms, which a slow (remote) database
    // easily exceeds -> "Transaction already closed" (P2028). Applies to every
    // prisma.$transaction(async tx => ...) in the app.
    transactionOptions: { maxWait: 10000, timeout: 30000 },
  });
if (process.env.NODE_ENV !== 'production') global.prisma = prisma;
 
export default prisma;
