import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
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
    description: 'Ссылка на VPN подписку',
    example: 'https://sub.avtlk.ru/sub/MuzMPA84wkb6NYhKnrxNcRKun',
  })
  @IsUrl({ require_protocol: true })
  url: string;

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
}
