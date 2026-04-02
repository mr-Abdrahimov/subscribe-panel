import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateGroupSettingsDto {
  @ApiPropertyOptional({
    description:
      'Название профиля подписки для группы: страница /sub/{code} и заголовки profile-title при запросе ленты. Имена серверов в строках подписки (фрагмент #) не меняются — из поля name коннекта. Пусто/null — в profile-title подставляется имя пользователя панели.',
    example: 'Корпоративный VPN',
    maxLength: 200,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subscriptionDisplayName?: string | null;
}
