import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreatePanelUserDto {
  @ApiProperty({ description: 'Имя пользователя панели', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: 'Код в URL подписки /sub/…', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  code!: string;

  @ApiProperty({
    description:
      'Одна или несколько групп (все имена должны существовать в справочнике). Лента объединяет коннекты всех групп без дубликатов строк.',
    type: [String],
    example: ['Офис', 'VIP'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  groupNames!: string[];

  @ApiPropertyOptional({
    description:
      'Если true — полная лента только с секретного пути; обычный /sub/… — заглушка',
  })
  @IsOptional()
  @IsBoolean()
  cryptoOnlySubscription?: boolean;

  @ApiPropertyOptional({
    description: 'Если true — подписка отдаётся любому User-Agent',
  })
  @IsOptional()
  @IsBoolean()
  allowAllUserAgents?: boolean;

  @ApiPropertyOptional({
    description:
      'Если true — на crypto-странице лента отдаётся в формате JSON (массив v2ray-конфигов из rawJson коннектов). Работает только при via=crypto-page.',
  })
  @IsOptional()
  @IsBoolean()
  feedJsonMode?: boolean;
}
