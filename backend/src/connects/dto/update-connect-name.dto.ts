import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateConnectNameDto {
  @ApiProperty({
    description: 'Кастомное название коннекта',
    example: 'Рабочий VPN',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;
}
