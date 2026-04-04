import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PublicSubscriptionGroupPrefItemDto {
  @ApiProperty({
    description: 'Имя группы (как в PanelUser.groupNames)',
    example: 'Офис',
  })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    description: 'Включить коннекты этой группы в ленту подписки',
  })
  @IsBoolean()
  include!: boolean;
}

export class PublicSubscriptionGroupPrefsDto {
  @ApiProperty({
    description:
      'Полный список групп пользователя в нужном порядке: те же имена, что в groupNames, без пропусков и дубликатов',
    type: [PublicSubscriptionGroupPrefItemDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PublicSubscriptionGroupPrefItemDto)
  groups!: PublicSubscriptionGroupPrefItemDto[];
}
