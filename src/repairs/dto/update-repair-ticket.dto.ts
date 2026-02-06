import { PartialType } from '@nestjs/mapped-types';
import { CreateRepairTicketDto } from './create-repair-ticket.dto';
import { IsOptional, IsEnum, IsNumber, IsArray, IsString, IsDateString } from 'class-validator';
import { RepairTicketStatus } from '@prisma/client';

export class UpdateRepairTicketDto extends PartialType(CreateRepairTicketDto) {
  @IsOptional()
  @IsEnum(RepairTicketStatus)
  status?: RepairTicketStatus;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  messageToReporter?: string;

  @IsOptional()
  scheduledAt?: Date;

  @IsOptional()
  @IsDateString()
  estimatedCompletionDate?: string;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  assigneeIds?: number[];

  @IsOptional()
  completedAt?: Date;
}
