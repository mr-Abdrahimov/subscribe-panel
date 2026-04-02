import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AddTagDto } from './dto/add-tag.dto';
import { ConnectsService } from './connects.service';
import { ReorderConnectsDto } from './dto/reorder-connects.dto';
import { UpdateConnectNameDto } from './dto/update-connect-name.dto';

@ApiTags('connects')
@Controller('connects')
export class ConnectsController {
  constructor(private readonly connectsService: ConnectsService) {}

  @Get()
  @ApiOperation({ summary: 'Получить список коннектов' })
  @ApiResponse({ status: 200, description: 'Список коннектов успешно получен' })
  findAll() {
    return this.connectsService.findAll();
  }

  @Patch(':id/toggle-status')
  @ApiOperation({ summary: 'Изменить статус коннекта (ACTIVE/INACTIVE)' })
  @ApiResponse({ status: 200, description: 'Статус коннекта успешно изменен' })
  toggleStatus(@Param('id') id: string) {
    return this.connectsService.toggleStatus(id);
  }

  @Patch(':id/hide')
  @ApiOperation({ summary: 'Переключить видимость коннекта (Скрытый/Видимый)' })
  @ApiResponse({
    status: 200,
    description: 'Видимость коннекта успешно изменена',
  })
  hide(@Param('id') id: string) {
    return this.connectsService.hide(id);
  }

  @Post(':id/tags')
  @ApiOperation({ summary: 'Добавить тэг к коннекту' })
  @ApiResponse({ status: 201, description: 'Тэг успешно добавлен' })
  addTag(@Param('id') id: string, @Body() dto: AddTagDto) {
    return this.connectsService.addTag(id, dto.tag);
  }

  @Patch(':id/name')
  @ApiOperation({ summary: 'Обновить кастомное название коннекта' })
  @ApiResponse({
    status: 200,
    description: 'Название коннекта успешно обновлено',
  })
  updateName(@Param('id') id: string, @Body() dto: UpdateConnectNameDto) {
    return this.connectsService.updateName(id, dto.name);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить коннект' })
  @ApiResponse({ status: 200, description: 'Коннект успешно удален' })
  remove(@Param('id') id: string) {
    return this.connectsService.remove(id);
  }

  @Patch('reorder')
  @ApiOperation({ summary: 'Обновить порядок коннектов' })
  @ApiResponse({
    status: 200,
    description: 'Порядок коннектов успешно обновлен',
  })
  reorder(@Body() dto: ReorderConnectsDto) {
    return this.connectsService.reorder(dto.ids);
  }
}
