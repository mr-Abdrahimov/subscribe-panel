import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdatePanelUserDto {
  @ApiPropertyOptional({
    description: 'Включён ли пользователь панели (доступ к подписке по ссылке)',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

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
    description:
      'Код в URL подписки /sub/… (уникален). При смене бэкенд заново запрашивает happ:// у crypto.happ.su для нового URL с тем же секретом t=.',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  code?: string;

  @ApiPropertyOptional({
    description:
      'Группы пользователя (полная замена списка). Все названия должны существовать в справочнике.',
    type: [String],
    example: ['Офис', 'VIP'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  groupNames?: string[];

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

  @ApiPropertyOptional({
    description:
      'Максимум уникальных HWID по логам GET /public/sub/:code. 0 — лимит не применяется. Заглушка «Превышен лимит HWID», если в запросе передан новый HWID и число уникальных (включая его) превысит лимит; уже зарегистрированный для этого пользователя HWID — лента выдаётся (если не включено «Обязательно без HWID»).',
    minimum: 0,
    maximum: 10_000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  maxUniqueHwids?: number;

  @ApiPropertyOptional({
    description:
      'Режим «только crypto»: полная лента с альтернативного пути (via=crypto-page); запрос ленты по /sub/CODE?t=… без via — заглушка «Только Cripto». Сохранённая happ:// ссылка не сбрасывается.',
  })
  @IsOptional()
  @IsBoolean()
  cryptoOnlySubscription?: boolean;
}
