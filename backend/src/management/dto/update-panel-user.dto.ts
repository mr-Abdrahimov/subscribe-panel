import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePanelUserDto {
  @ApiPropertyOptional({
    description: 'Отображаемое имя пользователя панели',
    example: 'Иван',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    description: 'Название группы (должна существовать в справочнике групп)',
    example: 'Офис',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  groupName?: string;
}
