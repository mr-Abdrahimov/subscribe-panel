import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: 'Получить список подписок' })
  @ApiResponse({ status: 200, description: 'Список подписок успешно получен' })
  findAll() {
    return this.subscriptionsService.findAll();
  }

  @Post()
  @ApiOperation({ summary: 'Создать подписку' })
  @ApiResponse({ status: 201, description: 'Подписка успешно создана' })
  create(@Body() dto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить подписку' })
  @ApiResponse({ status: 200, description: 'Подписка успешно обновлена' })
  update(@Param('id') id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.subscriptionsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить подписку' })
  @ApiResponse({ status: 200, description: 'Подписка и связанные коннекты удалены' })
  remove(@Param('id') id: string) {
    return this.subscriptionsService.remove(id);
  }

  @Post(':id/fetch')
  @ApiOperation({ summary: 'Получить и сохранить коннекты из подписки' })
  @ApiResponse({
    status: 200,
    description: 'Коннекты успешно получены, сохранены и привязаны к подписке',
  })
  fetchConnects(@Param('id') id: string) {
    return this.subscriptionsService.fetchConnects(id);
  }
}

