import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateSubscriptionAppLinkDto {
  @ApiPropertyOptional({
    description: 'Отображаемое название приложения',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Ссылка или шаблон; при наличии {link} — подстановка полного URL страницы подписки',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  urlTemplate?: string;

  @ApiPropertyOptional({ description: 'Порядок сортировки', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
