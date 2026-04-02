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
      'Шаблон ссылки. Обязательно включите подстроку {link} — она будет заменена на полный URL страницы подписки (например https://example.com/sub/CODE).',
    example: 'happ://import-remote-profile?url={link}',
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
