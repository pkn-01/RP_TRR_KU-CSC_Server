import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Checking all users in database ===\n');
  
  const users = await prisma.user.findMany();
  
  if (users.length === 0) {
    console.log('❌ No users found in database!');
  } else {
    console.log(`✅ Found ${users.length} users:\n`);
    users.forEach((user) => {
      console.log(`  ID: ${user.id}`);
      console.log(`  Email: ${user.email}`);
      console.log(`  Name: ${user.name}`);
      console.log(`  Role: ${user.role}`);
      console.log('---');
    });
  }
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
