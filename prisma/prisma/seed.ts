import { PrismaClient, Role, Priority, TicketStatus, ProblemCategory, ProblemSubcategory } from '@prisma/client';
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

  // Create test tickets for repair system
  const adminUser = await prisma.user.findUnique({
    where: { email: 'admin@company.com' },
  });

  const itUser = await prisma.user.findUnique({
    where: { email: 'it@company.com' },
  });

  if (adminUser && itUser) {
    const ticketExists = await prisma.ticket.findFirst({
      where: { userId: adminUser.id },
    });

    if (!ticketExists) {
      await prisma.ticket.create({
        data: {
          ticketCode: `TKT-2025-${Date.now().toString().slice(-6)}`,
          title: 'เครื่องพิมพ์ไม่ทำงาน',
          description: 'เครื่องพิมพ์ HP LaserJet ในห้องธุรการไม่สามารถพิมพ์เอกสารได้',
          equipmentName: 'HP LaserJet Pro M404n',
          equipmentId: 'FS-CNT-6407001',
          location: 'ห้องธุรการ ชั้น 3',
          category: 'REPAIR',
          problemCategory: ProblemCategory.PERIPHERAL,
          problemSubcategory: ProblemSubcategory.OTHER,
          priority: Priority.HIGH,
          status: TicketStatus.OPEN,
          notes: 'ตรวจเชคหมึก ปลั๊ก และการเชื่อมต่อ',
          requiredDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          userId: adminUser.id,
          assignedTo: itUser.id,
        },
      });

      console.log('✅ Created test repair ticket');
    } else {
      console.log('⚠️ Test ticket already exists');
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
