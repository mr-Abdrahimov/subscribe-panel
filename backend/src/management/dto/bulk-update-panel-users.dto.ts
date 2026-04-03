import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Массовые операции над пользователями панели.
 * Должно быть задано хотя бы одно из полей обновления или clearSubscriptionAccessLogs.
 */
export class BulkUpdatePanelUsersDto {
  @ApiProperty({
    description: 'Идентификаторы пользователей панели (MongoDB ObjectId)',
    example: ['680f5f51d3a6a0a9af0e01aa'],
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids: string[];

  @ApiPropertyOptional({
    description:
      'Назначить группу. Если указано restrictToCurrentGroupName — обновляются только выбранные пользователи с текущей группой, совпадающей с этим значением (перенос из группы)',
    example: 'Офис',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  groupName?: string;

  @ApiPropertyOptional({
    description:
      'Используется только вместе с groupName: менять группу только у пользователей, у которых сейчас эта группа (среди переданных в ids)',
    example: 'Старая',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  restrictToCurrentGroupName?: string;

  @ApiPropertyOptional({
    description: 'Включить или отключить пользователей панели',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Если true — подписка /public/sub отдаётся любому User-Agent; если false — только при User-Agent, начинающемся с «Happ»',
  })
  @IsOptional()
  @IsBoolean()
  allowAllUserAgents?: boolean;

  @ApiPropertyOptional({
    description:
      'Лимит уникальных HWID по логам GET /public/sub/:code. 0 — не ограничивать',
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
      'Режим «только crypto»: полная лента с альтернативного пути; по /sub/… — заглушка «Только crypto». happCryptoUrl не очищается.',
  })
  @IsOptional()
  @IsBoolean()
  cryptoOnlySubscription?: boolean;

  @ApiPropertyOptional({
    description:
      'Удалить все записи PanelUserAccessLog для каждого из ids (HWID, IP, User-Agent в логах подписки)',
  })
  @IsOptional()
  @IsBoolean()
  clearSubscriptionAccessLogs?: boolean;
}
