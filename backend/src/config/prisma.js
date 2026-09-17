import prismaPackage from '@prisma/client';

const { PrismaClient } = prismaPackage;

// Reuse a single Prisma instance across the app (important in dev with hot-reload,
// where re-importing this file shouldn't open a new DB connection each time)
const prisma = global.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') global.prisma = prisma;

export default prisma;
