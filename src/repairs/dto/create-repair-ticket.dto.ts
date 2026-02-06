import { IsString, IsOptional, IsNumber, IsEnum } from 'class-validator';
import { ProblemCategory, UrgencyLevel } from '@prisma/client';

export class CreateRepairTicketDto {
  @IsString()
  reporterName: string;

  @IsOptional()
  @IsString()
  reporterDepartment?: string;

  @IsOptional()
  @IsString()
  reporterPhone?: string;

  @IsOptional()
  @IsString()
  reporterLineId?: string;

  @IsEnum(ProblemCategory)
  problemCategory: ProblemCategory;

  @IsString()
  problemTitle: string;

  @IsOptional()
  @IsString()
  problemDescription?: string;

  @IsString()
  location: string;

  @IsOptional()
  @IsEnum(UrgencyLevel)
  urgency?: UrgencyLevel;

  @IsOptional()
  @IsNumber()
  assignedTo?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  scheduledAt?: Date;
}
