import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class ReorderGroupsDto {
  @ApiProperty({
    description:
      'Порядок групп: массив ID всех групп в нужной последовательности (длина и состав должны совпадать с группами в БД)',
    example: ['680f5f51d3a6a0a9af0e01aa', '680f5f51d3a6a0a9af0e01ab'],
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids: string[];
}
