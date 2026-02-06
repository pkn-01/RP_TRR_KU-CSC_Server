import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function resetAdminPassword() {
  // ตั้งรหัสผ่านใหม่ที่นี่
  const newPassword = 'Admin@123456';
  
  // Hash password ด้วย bcrypt
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  
  try {
    // อัพเดต admin user
    const updatedUser = await prisma.user.update({
      where: { email: 'admin@trr.com' },
      data: { password: hashedPassword },
    });
    
    console.log('✅ รีเซ็ตรหัสผ่าน Admin สำเร็จ!');
    console.log('----------------------------------------');
    console.log('📧 Email:', updatedUser.email);
    console.log('🔑 Password:', newPassword);
    console.log('👤 Role:', updatedUser.role);
    console.log('----------------------------------------');
    console.log('ไปที่ /login/admin แล้วใช้ข้อมูลด้านบนเพื่อเข้าสู่ระบบ');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

resetAdminPassword();
