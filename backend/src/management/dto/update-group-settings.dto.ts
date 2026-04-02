import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateGroupSettingsDto {
  @ApiPropertyOptional({
    description:
      'Название профиля подписки для группы: страница /sub/{code} и HTTP-заголовки profile-title* / profile-title при запросе base64-ленты (только из настроек; без подстановки имени пользователя панели). Имена в строках подписки (фрагмент #) — из поля name коннекта.',
    example: 'Корпоративный VPN',
    maxLength: 200,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subscriptionDisplayName?: string | null;
}
