import "dotenv/config";
import app from "./app.js";
import prisma from "./config/prisma.js";

const PORT = process.env.PORT || 4000;

const startServer = async () => {
  try {
    await prisma.$connect();

    console.log("PostgreSQL connected successfully");

    // Prisma opens database connections lazily, and each new one costs a slow
    // handshake. Open a few now (in parallel) so the first page load after a
    // restart doesn't pay for them.
    await Promise.all(Array.from({ length: 4 }, () => prisma.$queryRaw`SELECT 1`)).catch(() => {});

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Database connection failed:", error.message);
    process.exit(1);
  }
};

startServer();
