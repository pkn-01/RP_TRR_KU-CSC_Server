import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateStockDto } from './create-stock.dto';

export class BulkImportStockDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStockDto)
  items: CreateStockDto[];
}
