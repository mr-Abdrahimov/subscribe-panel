import { ApiPropertyOptional } from '@nestjs/swagger';
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

export class UpdatePanelGlobalSettingsDto {
  @ApiPropertyOptional({
    description: `Текст объявления для всех ответов подписки Happ: строка «#announce: base64:…» в теле и заголовок announce. Пустая строка — отключить. Не более ${HAPP_ANNOUNCE_MAX_CHARS} символов (Unicode).`,
    maxLength: HAPP_ANNOUNCE_MAX_CHARS,
  })
  @IsOptional()
  @IsString()
  @MaxLength(HAPP_ANNOUNCE_MAX_CHARS)
  subscriptionAnnounce?: string;

  @ApiPropertyOptional({
    description:
      'Интервал автообновления подписки в Happ (часы, целое от 1 до 8760). null — отключить параметр в ленте.',
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
