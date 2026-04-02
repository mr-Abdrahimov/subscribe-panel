import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { UpdateGroupSettingsDto } from './dto/update-group-settings.dto';
import { ManagementService } from './management.service';

@ApiTags('Управление')
@Controller()
export class ManagementController {
  constructor(private readonly managementService: ManagementService) {}

  @Get('groups')
  @ApiOperation({ summary: 'Получить список групп' })
  listGroups() {
    return this.managementService.listGroups();
  }

  @Post('groups')
  @ApiOperation({ summary: 'Создать группу' })
  createGroup(@Body() body: { name: string }) {
    return this.managementService.createGroup(body.name);
  }

  @Delete('groups/:id')
  @ApiOperation({ summary: 'Удалить группу' })
  removeGroup(@Param('id') id: string) {
    return this.managementService.deleteGroup(id);
  }

  @Patch('groups/:id')
  @ApiOperation({
    summary: 'Обновить настройки группы',
    description:
      'Частичное обновление. Поле subscriptionDisplayName задаёт название для публичной подписки (страница /sub и имена в ленте). Передайте null или пустую строку, чтобы снова использовать названия коннектов из панели.',
  })
  @ApiResponse({ status: 200, description: 'Группа успешно обновлена' })
  @ApiResponse({ status: 404, description: 'Группа не найдена' })
  updateGroup(@Param('id') id: string, @Body() body: UpdateGroupSettingsDto) {
    return this.managementService.updateGroupSettings(id, body);
  }

  @Get('panel-users')
  @ApiOperation({ summary: 'Получить список пользователей панели' })
  listUsers() {
    return this.managementService.listUsers();
  }

  @Post('panel-users')
  @ApiOperation({ summary: 'Создать пользователя панели' })
  createUser(@Body() body: { name: string; code: string; groupName: string }) {
    return this.managementService.createUser(body.name, body.code, body.groupName);
  }

  @Delete('panel-users/:id')
  @ApiOperation({ summary: 'Удалить пользователя панели' })
  removeUser(@Param('id') id: string) {
    return this.managementService.deleteUser(id);
  }

  @Patch('panel-users/:id/toggle')
  @ApiOperation({ summary: 'Переключить активность пользователя панели' })
  toggleUser(@Param('id') id: string) {
    return this.managementService.toggleUser(id);
  }

  @Patch('connects/:id/groups')
  @ApiOperation({ summary: 'Назначить группы коннекту' })
  setConnectGroups(@Param('id') id: string, @Body() body: { groupNames: string[] }) {
    return this.managementService.setConnectGroups(id, body.groupNames ?? []);
  }

  @Get('public/users/:code')
  @Header('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOperation({ summary: 'Получить публичную информацию пользователя по коду' })
  getPublicUser(@Param('code') code: string) {
    return this.managementService.getPublicUserByCode(code);
  }

  @Get('public/sub/:code')
  @ApiOperation({
    summary: 'Получить base64-подписку по коду пользователя',
    description:
      'Каждая строка — URI коннекта; в фрагменте (#) подставляется название: если для группы пользователя задано «Название» в настройках — оно для всех строк; иначе — кастомное название коннекта из панели.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Тело: строка base64 (UTF-8 текст, по строке на коннект). Заголовок ответа profile-title — название из настроек группы (поле «Название для публичной подписки»), при отсутствии — имя пользователя панели.',
  })
  async getPublicSubscription(@Param('code') code: string, @Res() res: Response) {
    const { encoded, profileTitle } =
      await this.managementService.getPublicFeedByCode(code);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Cache-Control',
      'private, no-store, no-cache, must-revalidate, max-age=0',
    );
    res.setHeader('Pragma', 'no-cache');
    if (profileTitle) {
      res.setHeader('profile-title', profileTitle);
    }
    res.send(encoded);
  }
}

