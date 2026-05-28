import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

export async function initDatabase(): Promise<void> {
  const client = getPrisma();
  // Test connection
  await client.$connect();
  console.log('Database connected successfully');
}

export async function closeDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
  }
}