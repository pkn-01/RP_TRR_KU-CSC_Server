import { IsString, IsOptional, IsNumber, IsEnum, IsNotEmpty, MaxLength, Matches } from 'class-validator';
import { ProblemCategory, UrgencyLevel } from '@prisma/client';

export class CreateRepairTicketDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุชื่อผู้แจ้ง' })
  @MaxLength(100, { message: 'ชื่อผู้แจ้งต้องไม่เกิน 100 ตัวอักษร' })
  reporterName: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reporterDepartment?: string;

  @IsOptional()
  @IsString()
  @Matches(/^0\d{9}$/, { message: 'เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0' })
  reporterPhone?: string;

  @IsOptional()
  @IsString()
  reporterLineId?: string;

  @IsEnum(ProblemCategory)
  problemCategory: ProblemCategory;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุหัวข้อปัญหา' })
  @MaxLength(300, { message: 'หัวข้อปัญหาต้องไม่เกิน 300 ตัวอักษร' })
  problemTitle: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'รายละเอียดปัญหาต้องไม่เกิน 2000 ตัวอักษร' })
  problemDescription?: string;

  @IsString()
  @MaxLength(200)
  location: string;

  @IsOptional()
  @IsEnum(UrgencyLevel)
  urgency?: UrgencyLevel;

  @IsOptional()
  @IsNumber()
  assignedTo?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  scheduledAt?: Date;
}
