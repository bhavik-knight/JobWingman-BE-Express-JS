import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// Create a native pg connection pool using your existing Environment Variable
const pool = new pg.Pool({ 
  connectionString: process.env.DATABASE_URL 
});

const adapter = new PrismaPg(pool);

// Instantiate Prisma Client passing the network driver adapter
const prisma = new PrismaClient({ adapter });
export { prisma };
export default prisma;