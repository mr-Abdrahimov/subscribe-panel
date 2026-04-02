import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateGroupSettingsDto {
  @ApiPropertyOptional({
    description:
      'Название для публичной подписки: заголовок страницы по ссылке /sub/{code} и отображаемое имя каждого коннекта в VPN-клиенте (фрагмент URI). Пустая строка или null — сброс: в ленте используется кастомное название коннекта из панели.',
    example: 'Корпоративный VPN',
    maxLength: 200,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subscriptionDisplayName?: string | null;
}
