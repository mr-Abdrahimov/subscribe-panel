import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { HAPP_ANNOUNCE_MAX_CHARS } from '../../common/profile-title-header';

export class UpdateGroupSettingsDto {
  @ApiPropertyOptional({
    description:
      'Новое уникальное имя группы (как тег в коннектах и в groupNames пользователей панели). При смене имя обновится во всех связанных коннектах и пользователях.',
    example: 'Офис',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Название профиля подписки для группы: страница /sub/{code} и HTTP-заголовки profile-title* / profile-title при запросе base64-ленты (только из настроек; без подстановки имени пользователя панели). Имена в строках подписки (фрагмент #) — из поля name коннекта.',
    example: 'Корпоративный VPN',
    maxLength: 200,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(200)
  subscriptionDisplayName?: string | null;

  @ApiPropertyOptional({
    description: `Текст объявления Happ для пользователей этой группы. Пустая строка или null — не задавать на уровне группы (будут использоваться глобальные настройки панели). Не более ${HAPP_ANNOUNCE_MAX_CHARS} символов (Unicode).`,
    maxLength: HAPP_ANNOUNCE_MAX_CHARS,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(HAPP_ANNOUNCE_MAX_CHARS)
  subscriptionAnnounce?: string | null;

  @ApiPropertyOptional({
    description:
      'Интервал автообновления подписки в Happ (часы, 1–8760). null — не задавать на уровне группы (наследование из глобальных настроек панели).',
    nullable: true,
    minimum: 1,
    maximum: 8760,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  profileUpdateInterval?: number | null;

  @ApiPropertyOptional({
    description:
      'Флаг «главная группа» для коннектов: нельзя назначить коннекту две главные группы сразу.',
  })
  @IsOptional()
  @IsBoolean()
  isMainGroup?: boolean;
}
