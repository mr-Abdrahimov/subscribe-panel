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
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { setProfileTitleResponseHeaders } from '../common/profile-title-header';
import {
  extractSubscriptionAccessMeta,
  hasSubscriptionHwid,
} from '../common/subscription-client-meta';
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
      'Частичное обновление: name, groupName, allowAllUserAgents (выдавать подписку всем User-Agent), requireHwid (без HWID — ответ с ошибкой). Код подписки (code) не меняется.',
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

  @Get('panel-users/:id/subscription-access-logs')
  @ApiOperation({
    summary: 'Логи обращений к подписке пользователя панели',
    description:
      'Записи PanelUserAccessLog при успешной выдаче ленты GET /public/sub/:code: IP, User-Agent, HWID (если передан), query и дополнительные заголовки. Сортировка по убыванию времени. Параметр limit — от 1 до 500, по умолчанию 200.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Объект: user (name, code) и logs — массив записей с полями id, clientIp, userAgent, hwid, accept, acceptLanguage, referer, queryParams, extraHeaders, createdAt.',
  })
  @ApiResponse({ status: 404, description: 'Пользователь не найден' })
  listSubscriptionAccessLogs(
    @Param('id') id: string,
    @Query('limit') limitRaw?: string,
  ) {
    const parsed = parseInt(limitRaw ?? '', 10);
    const limit = Number.isNaN(parsed)
      ? 200
      : Math.min(500, Math.max(1, parsed));
    return this.managementService.listPanelUserSubscriptionAccessLogs(id, limit);
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
      'Тело всегда base64(UTF-8). При успехе — реальные коннекты и profile-title группы. Если код не найден, пользователь отключён, User-Agent не Happ (и не включено «Выдавать всем»), либо нет обязательного HWID — вместо списка отдаётся один случайный vless из БД не берётся, имя в клиенте «Нет подключений», profile-title то же. Обращения с известным panelUserId пишутся в PanelUserAccessLog.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Тело: base64 (UTF-8): либо полная подписка, либо заглушка «Нет подключений».',
  })
  async getPublicSubscription(
    @Param('code') code: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = await this.managementService.findPanelUserByCode(code);

    const uaHeader = req.headers['user-agent'];
    const ua =
      typeof uaHeader === 'string'
        ? uaHeader.trim()
        : Array.isArray(uaHeader) && uaHeader[0]
          ? String(uaHeader[0]).trim()
          : '';

    let payload: {
      encoded: string;
      profileTitle: string;
      panelUserId: string | null;
    };

    if (!user) {
      payload =
        this.managementService.buildNoConnectionsPlaceholderFeed(null);
    } else if (!user.enabled) {
      payload = this.managementService.buildNoConnectionsPlaceholderFeed(
        user.id,
      );
    } else {
      const allowAll = user.allowAllUserAgents === true;
      const requireHwid = user.requireHwid === true;
      if (!allowAll && !ua.startsWith('Happ')) {
        payload = this.managementService.buildNoConnectionsPlaceholderFeed(
          user.id,
        );
      } else if (requireHwid && !hasSubscriptionHwid(req)) {
        payload = this.managementService.buildNoConnectionsPlaceholderFeed(
          user.id,
        );
      } else {
        payload = await this.managementService.buildPublicFeedForPanelUser(user);
      }
    }

    if (payload.panelUserId) {
      try {
        await this.managementService.logPanelUserSubscriptionAccess(
          payload.panelUserId,
          extractSubscriptionAccessMeta(req),
        );
      } catch (err) {
        this.logger.warn(
          `Не удалось записать лог обращения к подписке: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Cache-Control',
      'private, no-store, no-cache, must-revalidate, max-age=0',
    );
    res.setHeader('Pragma', 'no-cache');
    if (payload.profileTitle) {
      setProfileTitleResponseHeaders(res, payload.profileTitle);
    }
    res.send(payload.encoded);
  }
}

