import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class TelegramTestMessageDto {
  @ApiPropertyOptional({
    description:
      'Текст тестового сообщения; по умолчанию — стандартная фраза от панели',
    maxLength: 4096,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;
}
