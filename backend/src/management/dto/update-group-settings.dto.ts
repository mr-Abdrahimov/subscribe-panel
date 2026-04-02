import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateGroupSettingsDto {
  @ApiPropertyOptional({
    description:
      'Название подписки для группы: заголовок страницы /sub/{code}, заголовок ответа profile-title при получении ленты. Имена коннектов в строках подписки (фрагмент URI) всегда из поля name коннекта в БД. Пустая строка или null — для profile-title используется имя пользователя панели.',
    example: 'Корпоративный VPN',
    maxLength: 200,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subscriptionDisplayName?: string | null;
}
