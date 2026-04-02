import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { setProfileTitleResponseHeaders } from '../common/profile-title-header';
import { extractSubscriptionAccessMeta } from '../common/subscription-client-meta';
import { CreateSubscriptionAppLinkDto } from './dto/create-subscription-app-link.dto';
import { UpdateGroupSettingsDto } from './dto/update-group-settings.dto';
import { UpdatePanelUserDto } from './dto/update-panel-user.dto';
import { UpdateSubscriptionAppLinkDto } from './dto/update-subscription-app-link.dto';
import { ManagementService } from './management.service';

@ApiTags('Управление')
@Controller()
export class ManagementController {
  private readonly logger = new Logger(ManagementController.name);

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
      'Элементы: name и urlTemplate (необязательно с {link}). Порядок — sortOrder, затем дата создания.',
  })
  listSubscriptionAppLinks() {
    return this.managementService.listSubscriptionAppLinks();
  }

  @Post('subscription-app-links')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Добавить приложение',
    description:
      'Подстрока {link} в urlTemplate заменяется на полный URL подписки (PUBLIC_SUBSCRIPTION_BASE_URL или FRONTEND_ORIGIN + /sub/{code}). Без {link} ссылка не меняется.',
  })
  @ApiResponse({ status: 201, description: 'Создано' })
  @ApiResponse({ status: 400, description: 'Пустое название или пустая ссылка' })
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
      'Поле profileTitle — subscriptionDisplayName группы пользователя (заголовок ленты). Поле groups — названия групп для страницы /sub: привязка пользователя (groupName) и все группы из активных коннектов его ленты, без дублей, сортировка по-русски. subscriptionDisplayName остаётся в ответе для совместимости. Массив appLinks: подстановка {link} в полный URL подписки.',
  })
  getPublicUser(@Param('code') code: string) {
    return this.managementService.getPublicUserByCode(code);
  }

  @Get('public/sub/:code')
  @ApiOperation({
    summary: 'Получить base64-подписку по коду пользователя',
    description:
      "Тело — base64(UTF-8): при заданном названии группы первая строка после декодирования — «#profile-title: …» (совместимость с Happ; до 25 символов), далее URI коннектов. Фрагмент # в URI — Connect.name. Заголовки profile-title (plain или base64:…) и profile-title* — из настроек группы пользователя. Каждое успешное обращение записывается в лог (PanelUserAccessLog): IP, User-Agent, HWID и прочие заголовки/query, если клиент их передал.",
  })
  @ApiResponse({
    status: 200,
    description:
      'Тело: base64 (UTF-8), см. описание эндпоинта (#profile-title + строки подписки). Заголовки profile-title для клиентов вроде Happ.',
  })
  async getPublicSubscription(
    @Param('code') code: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { encoded, profileTitle, panelUserId } =
      await this.managementService.getPublicFeedByCode(code);
    try {
      await this.managementService.logPanelUserSubscriptionAccess(
        panelUserId,
        extractSubscriptionAccessMeta(req),
      );
    } catch (err) {
      this.logger.warn(
        `Не удалось записать лог обращения к подписке: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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

