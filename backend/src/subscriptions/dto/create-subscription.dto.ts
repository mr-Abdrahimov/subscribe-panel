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
}
