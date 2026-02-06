import { IsArray, IsBoolean, IsString, ArrayMinSize } from 'class-validator';

export class ClearDataDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  types: string[];

  @IsBoolean()
  exportFirst: boolean;
}

export class ExportDataDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  types: string[];
}

export interface DataTypeInfo {
  key: string;
  label: string;
  icon: string;
  count: number;
  description: string;
}
