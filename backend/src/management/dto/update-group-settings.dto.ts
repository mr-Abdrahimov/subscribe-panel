import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateGroupSettingsDto {
  @ApiPropertyOptional({
    description:
      'Название подписки для группы: страница /sub/{code}, заголовки profile-title ленты и фрагмент # в каждой строке. Пустая строка или null — в # подставляется name коннекта, в profile-title — имя пользователя панели.',
    example: 'Корпоративный VPN',
    maxLength: 200,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subscriptionDisplayName?: string | null;
}
