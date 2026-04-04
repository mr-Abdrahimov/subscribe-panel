import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { HAPP_ANNOUNCE_MAX_CHARS } from '../../common/profile-title-header';

export class CreateGroupDto {
  @ApiProperty({
    description:
      'Уникальное имя группы (совпадает с элементами PanelUser.groupNames и тегами коннектов). Имя «Без группы» зарезервировано: служебная группа создаётся автоматически.',
    example: 'Основная',
    maxLength: 200,
  })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({
    description:
      'Название профиля подписки для этой группы: /sub/{code} и заголовки profile-title ленты.',
    maxLength: 200,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subscriptionDisplayName?: string | null;

  @ApiPropertyOptional({
    description: `Текст объявления Happ (до ${HAPP_ANNOUNCE_MAX_CHARS} символов Unicode). Пусто/null — наследовать из глобальных настроек панели.`,
    maxLength: HAPP_ANNOUNCE_MAX_CHARS,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(HAPP_ANNOUNCE_MAX_CHARS)
  subscriptionAnnounce?: string | null;

  @ApiPropertyOptional({
    description:
      'Интервал автообновления подписки в Happ (часы, 1–8760). null — наследовать из глобальных настроек панели.',
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
}
