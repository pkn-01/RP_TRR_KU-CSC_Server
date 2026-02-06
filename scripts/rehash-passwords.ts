/**
 * Script to rehash any legacy plain-text passwords in the database
 * 
 * Run with: npx ts-node scripts/rehash-passwords.ts
 * 
 * WARNING: This script will update all passwords that don't look like bcrypt hashes.
 * Make sure you have a backup before running!
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Scanning for legacy plain-text passwords...\n');
  
  const users = await prisma.user.findMany({
    select: { id: true, email: true, password: true }
  });

  let updatedCount = 0;

  for (const user of users) {
    // bcrypt hashes start with $2a$, $2b$, or $2y$
    const isBcryptHash = /^\$2[aby]?\$\d+\$/.test(user.password);
    
    if (!isBcryptHash) {
      console.log(`⚠️  Found plain-text password for user: ${user.email}`);
      
      // Hash the password
      const hashedPassword = await bcrypt.hash(user.password, 10);
      
      await prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword }
      });
      
      console.log(`   ✅ Password rehashed successfully`);
      updatedCount++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Total users scanned: ${users.length}`);
  console.log(`   Passwords rehashed: ${updatedCount}`);
  
  if (updatedCount === 0) {
    console.log('\n✅ All passwords are already securely hashed!');
  } else {
    console.log(`\n⚠️  ${updatedCount} password(s) were updated. Make sure to inform affected users if needed.`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
