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

export class CreateSubscriptionDto {
  @ApiProperty({ description: 'Название подписки', example: 'Основная VPN' })
  @IsString()
  @MinLength(1)
  title: string;

  @ApiProperty({
    description: 'Ссылка на VPN подписку',
    example: 'https://sub.avtlk.ru/sub/MuzMPA84wkb6NYhKnrxNcRKun',
  })
  @IsUrl({ require_protocol: true })
  url: string;

  @ApiPropertyOptional({
    description:
      'Интервал автоматического получения коннектов (минуты), не реже чем раз в 5 минут. Не указывайте — обновление только вручную кнопкой «Получить коннекты».',
    minimum: 5,
    maximum: 10080,
    nullable: true,
    example: 60,
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
      'Необязательно. Заголовок User-Agent для HTTP GET по полю url при получении коннектов (вручную и через очередь).',
    nullable: true,
    maxLength: 2048,
    example: 'Happ/1.0',
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
      'Необязательно. Заголовок X-HWID для HTTP GET по полю url при получении коннектов (вручную и через очередь).',
    nullable: true,
    maxLength: 512,
    example: 'device-uuid-here',
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
