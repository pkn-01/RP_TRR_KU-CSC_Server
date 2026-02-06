import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsEmail,
} from 'class-validator';
import { Priority, ProblemCategory, ProblemSubcategory } from '@prisma/client';

export class CreateTicketDto {
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsString()
  @IsEnum(ProblemCategory)
  @IsOptional()
  problemCategory?: ProblemCategory;

  @IsString()
  @IsEnum(ProblemSubcategory)
  @IsOptional()
  problemSubcategory?: ProblemSubcategory;

  @IsString()
  equipmentName: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsEnum(Priority)
  @IsOptional()
  priority?: Priority;

  @IsString()
  @IsOptional()
  equipmentId?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  requiredDate?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsOptional()
  assignee?: { id: string; name: string } | null;

  // Guest information (for non-authenticated users)
  @IsString()
  @IsOptional()
  guestName?: string;

  @IsEmail()
  @IsOptional()
  guestEmail?: string;

  @IsString()
  @IsOptional()
  guestPhone?: string;

  @IsString()
  @IsOptional()
  guestDepartment?: string;
}

export class FileUploadDto {
  @IsArray()
  @IsOptional()
  files?: any[];
}
