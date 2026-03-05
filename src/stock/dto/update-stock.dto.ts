import { IsString, IsOptional, IsNumber, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateStockDto {
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'รหัสสินค้าต้องไม่เกิน 50 ตัวอักษร' })
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'ชื่อสินค้าต้องไม่เกิน 200 ตัวอักษร' })
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'จำนวนต้องเป็นตัวเลข' })
  @Min(0, { message: 'จำนวนต้องไม่ติดลบ' })
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'หมวดหมู่ต้องไม่เกิน 100 ตัวอักษร' })
  category?: string;
}
