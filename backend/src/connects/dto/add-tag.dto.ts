import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AddTagDto {
  @ApiProperty({ description: 'Тэг для коннекта', example: 'work' })
  @IsString()
  @MinLength(1)
  tag: string;
}

