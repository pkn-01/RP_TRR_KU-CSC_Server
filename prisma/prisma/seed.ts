import { PrismaClient, Role, RepairTicketStatus, UrgencyLevel } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('123456', 10);

  const users = [
    {
      name: 'System Admin',
      email: 'admin@company.com',
      role: Role.ADMIN,
    },
    {
      name: 'IT Support',
      email: 'it@company.com',
      role: Role.IT,
    },
    {
      name: 'Normal User',
      email: 'user@company.com',
      role: Role.USER,
    },
  ];

  for (const u of users) {
    const exists = await prisma.user.findUnique({
      where: { email: u.email },
    });

    if (!exists) {
      await prisma.user.create({
        data: {
          name: u.name,
          email: u.email,
          password,
          role: u.role,
        },
      });

      console.log(`✅ Created ${u.role}: ${u.email}`);
    } else {
      console.log(`⚠️ Exists: ${u.email}`);
    }
  }

  // Create test repair tickets
  const adminUser = await prisma.user.findUnique({
    where: { email: 'admin@company.com' },
  });

  const itUser = await prisma.user.findUnique({
    where: { email: 'it@company.com' },
  });

  if (adminUser && itUser) {
    const repairExists = await prisma.repairTicket.findFirst({
      where: { userId: adminUser.id },
    });

    if (!repairExists) {
      await prisma.repairTicket.create({
        data: {
          ticketCode: `RP-2025-${Date.now().toString().slice(-6)}`,
          problemTitle: 'เครื่องพิมพ์ไม่ทำงาน (Repair)',
          problemDescription: 'เครื่องพิมพ์ HP LaserJet ในห้องธุรการไม่สามารถพิมพ์เอกสารได้ (Seed Data)',
          location: 'ห้องธุรการ ชั้น 3',
          urgency: UrgencyLevel.URGENT,
          status: RepairTicketStatus.PENDING,
          reporterName: adminUser.name,
          reporterPhone: '0812345678',
          userId: adminUser.id,
        },
      });

      console.log('✅ Created test repair ticket');
    } else {
      console.log('⚠️ Test repair ticket already exists');
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
