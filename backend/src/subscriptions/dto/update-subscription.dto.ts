import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateSubscriptionDto {
  @ApiProperty({ description: 'Название подписки', example: 'Резервная VPN' })
  @IsString()
  @MinLength(1)
  title: string;

  @ApiProperty({
    description: 'Саб ссылка: URL подписки для получения ленты (коннектов)',
    example: 'https://sub.avtlk.ru/sub/MuzMPA84wkb6NYhKnrxNcRKun',
  })
  @IsUrl({ require_protocol: true })
  url: string;

  @ApiPropertyOptional({
    description:
      'Ссылка на источник (откуда получена саб ссылка). Передайте null — очистить. Не передавайте поле — оставить как в БД.',
    nullable: true,
    maxLength: 2048,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): string | null | undefined => {
    if (value === undefined || value === '') {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    const s = typeof value === 'string' ? value.trim() : String(value).trim();
    if (s === '') {
      return null;
    }
    return s;
  })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  sourceUrl?: string | null;

  @ApiPropertyOptional({
    description:
      'Интервал автообновления коннектов (минуты), ≥ 5. Передайте null — отключить автообновление (только ручное). Не передавайте поле — оставить прежнее значение в БД.',
    minimum: 5,
    maximum: 10080,
    nullable: true,
    example: null,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): number | null | undefined => {
    if (value === undefined || value === '') return undefined;
    if (value === null) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return Number.NaN;
    }
    return Math.trunc(n);
  })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(5)
  @Max(10080)
  fetchIntervalMinutes?: number | null;

  @ApiPropertyOptional({
    description:
      'Заголовок User-Agent для GET по саб ссылке (url). Передайте null — сбросить. Не передавайте поле — оставить как в БД.',
    nullable: true,
    maxLength: 2048,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): string | null | undefined => {
    if (value === undefined || value === '') {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    return typeof value === 'string' ? value : String(value);
  })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(2048)
  userAgent?: string | null;

  @ApiPropertyOptional({
    description:
      'Заголовок X-HWID для GET по саб ссылке (url). Передайте null — сбросить. Не передавайте поле — оставить как в БД.',
    nullable: true,
    maxLength: 512,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): string | null | undefined => {
    if (value === undefined || value === '') {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    return typeof value === 'string' ? value : String(value);
  })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(512)
  hwid?: string | null;
}
