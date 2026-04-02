import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class ReorderConnectsDto {
  @ApiProperty({
    description: 'Порядок коннектов в виде массива ID',
    example: ['680f5f51d3a6a0a9af0e01aa', '680f5f51d3a6a0a9af0e01ab'],
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids: string[];
}

