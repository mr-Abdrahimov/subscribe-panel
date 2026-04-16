import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateBalancerDto {
  @ApiPropertyOptional({ description: 'Новое название балансировщика' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    description: 'Новый список ID коннектов в пуле',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  connectIds?: string[];
}
