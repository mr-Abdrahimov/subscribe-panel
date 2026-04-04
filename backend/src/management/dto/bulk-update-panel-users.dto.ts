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
      'Без restrictToCurrentGroupName — полная замена списка групп пользователя одной группой (имя должно существовать в справочнике). С restrictToCurrentGroupName — у выбранных пользователей, у которых в groupNames есть указанная группа: эта группа заменяется на новую, остальные группы сохраняются',
    example: 'Офис',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  groupName?: string;

  @ApiPropertyOptional({
    description:
      'Только вместе с groupName: затрагиваются только пользователи из ids, у которых в массиве groupNames есть эта группа (точное совпадение строки)',
    example: 'Старая',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  restrictToCurrentGroupName?: string;

  @ApiPropertyOptional({
    description:
      'Добавить группу к каждому из выбранных: имя дописывается в groupNames, если его ещё нет (остальные группы не удаляются). Несовместимо с groupName, removeGroupName и restrictToCurrentGroupName',
    example: 'VIP',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addGroupName?: string;

  @ApiPropertyOptional({
    description:
      'Убрать группу у каждого из выбранных: имя удаляется из groupNames, если было. У пользователя должна остаться хотя бы одна группа (иначе 400). Несовместимо с groupName, addGroupName и restrictToCurrentGroupName',
    example: 'VIP',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  removeGroupName?: string;

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
      'Лимит уникальных HWID по логам GET /public/sub/:code. 0 — не ограничивать. Новый HWID сверх лимита — заглушка; уже учтённый HWID этого пользователя — полная лента.',
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
      'Режим «только crypto»: полная лента с альтернативного пути; по /sub/… — заглушка «Только Cripto». happCryptoUrl не очищается.',
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
