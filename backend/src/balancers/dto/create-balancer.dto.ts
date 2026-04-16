import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBalancerDto {
  @ApiProperty({ description: 'Название балансировщика', example: 'Быстрый пул' })
  @IsString()
  @MinLength(1, { message: 'Название не может быть пустым' })
  @MaxLength(200, { message: 'Не более 200 символов' })
  name: string;

  @ApiProperty({
    description: 'ID коннектов, входящих в пул балансировщика',
    type: [String],
    example: ['60b8d6f1e1b0c12a3c4d5e6f'],
  })
  @IsArray()
  @IsMongoId({ each: true, message: 'Каждый элемент должен быть корректным ID коннекта' })
  connectIds: string[];
}
