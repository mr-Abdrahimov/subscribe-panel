import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { setProfileTitleResponseHeaders } from '../common/profile-title-header';
import { CreateSubscriptionAppLinkDto } from './dto/create-subscription-app-link.dto';
import { UpdateGroupSettingsDto } from './dto/update-group-settings.dto';
import { UpdatePanelUserDto } from './dto/update-panel-user.dto';
import { UpdateSubscriptionAppLinkDto } from './dto/update-subscription-app-link.dto';
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
      'Частичное обновление. Поле subscriptionDisplayName — название профиля для этой группы: для пользователей панели с PanelUser.groupName = имя группы — страница /sub и заголовки profile-title ленты. Строки ленты (#) — из name коннекта.',
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

  @Patch('panel-users/:id')
  @ApiOperation({
    summary: 'Обновить пользователя панели',
    description:
      'Частичное обновление полей name и/или groupName. Код подписки (code) не меняется.',
  })
  @ApiResponse({ status: 200, description: 'Пользователь успешно обновлён' })
  @ApiResponse({ status: 400, description: 'Некорректные данные или группа не найдена' })
  @ApiResponse({ status: 404, description: 'Пользователь не найден' })
  updatePanelUser(@Param('id') id: string, @Body() body: UpdatePanelUserDto) {
    return this.managementService.updatePanelUser(id, body);
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

  @Get('subscription-app-links')
  @ApiOperation({
    summary: 'Список приложений для страницы подписки',
    description:
      'Элементы с полями name и urlTemplate ({link} в шаблоне). Порядок — sortOrder, затем дата создания.',
  })
  listSubscriptionAppLinks() {
    return this.managementService.listSubscriptionAppLinks();
  }

  @Post('subscription-app-links')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Добавить приложение',
    description:
      'В urlTemplate обязательна подстрока {link}; она заменяется на полный URL вида PUBLIC_SUBSCRIPTION_BASE_URL/sub/{code}.',
  })
  @ApiResponse({ status: 201, description: 'Создано' })
  @ApiResponse({ status: 400, description: 'Нет {link} или пустое название' })
  createSubscriptionAppLink(@Body() body: CreateSubscriptionAppLinkDto) {
    return this.managementService.createSubscriptionAppLink(body);
  }

  @Patch('subscription-app-links/:id')
  @ApiOperation({ summary: 'Изменить приложение' })
  @ApiResponse({ status: 404, description: 'Не найдено' })
  updateSubscriptionAppLink(
    @Param('id') id: string,
    @Body() body: UpdateSubscriptionAppLinkDto,
  ) {
    return this.managementService.updateSubscriptionAppLink(id, body);
  }

  @Delete('subscription-app-links/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить приложение' })
  @ApiResponse({ status: 204, description: 'Удалено' })
  @ApiResponse({ status: 404, description: 'Не найдено' })
  async deleteSubscriptionAppLink(@Param('id') id: string) {
    await this.managementService.deleteSubscriptionAppLink(id);
  }

  @Get('public/users/:code')
  @Header('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary: 'Получить публичную информацию пользователя по коду',
    description:
      'Поле profileTitle совпадает с заголовком profile-title ленты: subscriptionDisplayName той группы, к которой привязан пользователь панели (PanelUser.groupName). Если в настройках группы пусто — null; заголовки ленты тогда не отдаются; для HTML /sub фронт может подставить имя пользователя. Массив appLinks — названия и готовые ссылки для блока «Приложения» (шаблоны из админки с подстановкой {link}).',
  })
  getPublicUser(@Param('code') code: string) {
    return this.managementService.getPublicUserByCode(code);
  }

  @Get('public/sub/:code')
  @ApiOperation({
    summary: 'Получить base64-подписку по коду пользователя',
    description:
      "Тело — base64(UTF-8): при заданном названии группы первая строка после декодирования — «#profile-title: …» (совместимость с Happ; до 25 символов), далее URI коннектов. Фрагмент # в URI — Connect.name. Заголовки profile-title (plain или base64:…) и profile-title* — из настроек группы пользователя.",
  })
  @ApiResponse({
    status: 200,
    description:
      'Тело: base64 (UTF-8), см. описание эндпоинта (#profile-title + строки подписки). Заголовки profile-title для клиентов вроде Happ.',
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
      setProfileTitleResponseHeaders(res, profileTitle);
    }
    res.send(encoded);
  }
}

