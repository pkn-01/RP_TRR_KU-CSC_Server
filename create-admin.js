// Quick script to create admin user
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function createAdmin() {
  const adminEmail = 'admin@trr.com';
  const adminPassword = 'Admin@123';
  
  try {
    // Check if admin exists
    const existing = await prisma.user.findUnique({
      where: { email: adminEmail }
    });
    
    if (existing) {
      console.log('Admin already exists:', adminEmail);
      return;
    }
    
    // Create new admin
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    
    const admin = await prisma.user.create({
      data: {
        name: 'System Admin',
        email: adminEmail,
        password: hashedPassword,
        role: 'ADMIN',
        department: 'IT',
      }
    });
    
    console.log('Admin created successfully!');
    console.log('Email:', adminEmail);
    console.log(' Password:', adminPassword);
    console.log(' User ID:', admin.id);
    
  } catch (error) {
    console.error(' Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();
