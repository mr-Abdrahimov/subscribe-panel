import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

/**
 * Тело запроса: произвольный JSON-объект или массив (как у Prisma Json).
 * Валидация структуры выполняется в сервисе после парсинга.
 */
export class UpdateConnectRawJsonDto {
  @Allow()
  @ApiProperty({
    description:
      'Содержимое поля rawJson коннекта (объект/массив), полученного из JSON-подписки',
    example: { tag: 'proxy', protocol: 'vless', settings: {} },
  })
  rawJson!: unknown;
}
