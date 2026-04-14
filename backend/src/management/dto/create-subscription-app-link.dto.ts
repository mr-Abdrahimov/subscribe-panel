import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateSubscriptionAppLinkDto {
  @ApiProperty({
    description: 'Отображаемое название приложения на странице подписки',
    example: 'Happ (iOS)',
    maxLength: 120,
  })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    description:
      'Ссылка или шаблон. {link} → полный URL страницы подписки (FRONTEND_ORIGIN + /sub/CODE). {crypto} → ссылка happ://… из сервиса crypto.happ.su, сохранённая у пользователя при создании; если у пользователя нет значения — подстановка пустая. Плейсхолдеры необязательны.',
    example: 'happ://import-remote-profile?url={crypto}',
    maxLength: 2000,
  })
  @IsString()
  @MaxLength(2000)
  urlTemplate!: string;

  @ApiPropertyOptional({
    description: 'Порядок сортировки (меньше — выше в списке)',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
