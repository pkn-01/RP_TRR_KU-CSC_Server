import { IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class AddStockDto {
  @Type(() => Number)
  @IsNumber({}, { message: 'จำนวนต้องเป็นตัวเลข' })
  @Min(1, { message: 'จำนวนรับเข้าต้องอย่างน้อย 1' })
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'เลขอ้างอิงต้องไม่เกิน 100 ตัวอักษร' })
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร' })
  note?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  userId?: number;
}
