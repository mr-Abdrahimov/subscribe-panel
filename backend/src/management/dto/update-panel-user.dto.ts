import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

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

  @ApiPropertyOptional({
    description:
      'Если true — подписка /public/sub отдаётся любому User-Agent; если false — только при User-Agent, начинающемся с «Happ»',
  })
  @IsOptional()
  @IsBoolean()
  allowAllUserAgents?: boolean;

  @ApiPropertyOptional({
    description:
      'Если true — при отсутствии HWID в запросе (query или заголовки) клиент получает одну строку с текстом ошибки вместо списка коннектов',
  })
  @IsOptional()
  @IsBoolean()
  requireHwid?: boolean;

  @ApiPropertyOptional({
    description:
      'Если true — при наличии HWID в запросе клиент получает заглушку «Отключите HWID»; при включении сбрасывает requireHwid. Несовместимо с requireHwid.',
  })
  @IsOptional()
  @IsBoolean()
  requireNoHwid?: boolean;
}
