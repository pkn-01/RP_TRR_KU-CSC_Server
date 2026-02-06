import {
  IsString,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { Priority, TicketStatus } from '@prisma/client';

export class UpdateTicketDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  equipmentName?: string;

  @IsString()
  @IsOptional()
  equipmentId?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  requiredDate?: string;

  @IsEnum(Priority)
  @IsOptional()
  priority?: Priority;

  @IsEnum(TicketStatus)
  @IsOptional()
  status?: TicketStatus;

  @IsOptional()
  assignee?: { id: string; name: string } | null;
}
