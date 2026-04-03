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
import {
  setHappHideSettingsHeader,
  setProfileTitleResponseHeaders,
} from '../common/profile-title-header';
import {
  extractSubscriptionAccessMeta,
  hasSubscriptionHwid,
} from '../common/subscription-client-meta';
import { CreateSubscriptionAppLinkDto } from './dto/create-subscription-app-link.dto';
import { UpdateGroupSettingsDto } from './dto/update-group-settings.dto';
import { BulkUpdatePanelUsersDto } from './dto/bulk-update-panel-users.dto';
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
  @ApiOperation({
    summary: 'Получить список пользователей панели',
    description:
      'В каждом элементе: lastSubscriptionActivityAt — последний успешный GET /public/sub/:code; subscriptionUniqueHwidCount — число уникальных HWID в логах подписки; maxUniqueHwids — настраиваемый лимит (0 = не ограничивать).',
  })
  listUsers() {
    return this.managementService.listUsers();
  }

  @Post('panel-users')
  @ApiOperation({
    summary: 'Создать пользователя панели',
    description:
      'После создания бэкенд запрашивает happ:// у crypto.happ.su для URL с ?t=TOKEN. Опционально: cryptoOnlySubscription, allowAllUserAgents (по умолчанию false). GET /public/sub/:code: параметр t= опционален; если передан неверно — 403.',
  })
  createUser(
    @Body()
    body: {
      name: string;
      code: string;
      groupName: string;
      cryptoOnlySubscription?: boolean;
      allowAllUserAgents?: boolean;
    },
  ) {
    return this.managementService.createUser(
      body.name,
      body.code,
      body.groupName,
      body.cryptoOnlySubscription === true,
      body.allowAllUserAgents === true,
    );
  }

  @Delete('panel-users/:id')
  @ApiOperation({ summary: 'Удалить пользователя панели' })
  removeUser(@Param('id') id: string) {
    return this.managementService.deleteUser(id);
  }

  @Post('panel-users/bulk-update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Массовое обновление пользователей панели',
    description:
      'По списку ids: назначение группы (опционально restrictToCurrentGroupName), смена enabled, allowAllUserAgents, maxUniqueHwids, cryptoOnlySubscription, очистка логов подписки (PanelUserAccessLog). Требуется хотя бы одно действие.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Объект { updated: число обновлённых записей PanelUser, deletedLogs: число удалённых логов }',
  })
  @ApiResponse({ status: 400, description: 'Некорректные данные или группа не найдена' })
  bulkUpdatePanelUsers(@Body() body: BulkUpdatePanelUsersDto) {
    return this.managementService.bulkUpdatePanelUsers(body);
  }

  @Patch('panel-users/:id')
  @ApiOperation({
    summary: 'Обновить пользователя панели',
    description:
      'Частичное обновление: enabled, name, groupName, allowAllUserAgents, requireHwid, requireNoHwid, maxUniqueHwids, cryptoOnlySubscription (happCryptoUrl не сбрасывается). Код подписки (code) не меняется.',
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

  @Post('panel-users/:id/happ-crypto')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Создать happ crypto-ссылку для пользователя панели',
    description:
      'Запрашивает у crypto.happ.su зашифрованную ссылку happ://… для публичного URL подписки пользователя и сохраняет в поле happCryptoUrl. Если ссылка уже сохранена — возвращает её без повторного запроса к внешнему API.',
  })
  @ApiResponse({
    status: 200,
    description: 'Объект { happCryptoUrl: строка happ://… }',
  })
  @ApiResponse({
    status: 400,
    description: 'Не удалось получить ссылку (сервис crypto или настройки URL подписки)',
  })
  @ApiResponse({ status: 404, description: 'Пользователь не найден' })
  createPanelUserHappCrypto(@Param('id') id: string) {
    return this.managementService.createHappCryptoUrlForPanelUser(id);
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

  @Delete('panel-users/:id/subscription-access-logs')
  @ApiOperation({
    summary: 'Очистить логи обращений к подписке',
    description:
      'Удаляет все записи PanelUserAccessLog пользователя (HWID, IP, User-Agent и пр. при запросах base64 GET /public/sub/:code). Счётчик уникальных HWID в списке пользователей обнулится после перезагрузки списка.',
  })
  @ApiResponse({
    status: 200,
    description: 'Объект { deleted: число удалённых записей }',
  })
  @ApiResponse({ status: 404, description: 'Пользователь не найден' })
  clearSubscriptionAccessLogs(@Param('id') id: string) {
    return this.managementService.deleteAllPanelUserSubscriptionAccessLogs(id);
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
      'Элементы: name и urlTemplate (опционально плейсхолдеры {link}, {crypto}). Порядок — sortOrder, затем дата создания.',
  })
  listSubscriptionAppLinks() {
    return this.managementService.listSubscriptionAppLinks();
  }

  @Post('subscription-app-links')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Добавить приложение',
    description:
      'В urlTemplate: {link} → полный URL подписки; {crypto} → happ://… пользователя (crypto.happ.su при создании пользователя). Без плейсхолдеров ссылка не меняется.',
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
      'Поле profileTitle — subscriptionDisplayName группы (заголовок ленты). Поле groups — для страницы подписки. happCryptoUrl — готовая happ:// ссылка для импорта в Happ (или null). cryptoOnlySubscription — подсказка UI. Массив appLinks: {link}, {crypto}.',
  })
  getPublicUser(@Param('code') code: string) {
    return this.managementService.getPublicUserByCode(code);
  }

  @Get('public/sub/:code')
  @ApiOperation({
    summary: 'Получить base64-подписку по коду пользователя',
    description:
      'Тело всегда base64(UTF-8). Всегда присутствует строка #profile-web-page-url: абсолютный URL страницы …/sub/CODE (PUBLIC_SUBSCRIPTION_BASE_URL или FRONTEND_ORIGIN). Для Happ: #hide-settings в теле и заголовок hide-settings. Заглушки: #profile-title и заголовок profile-title — из subscriptionDisplayName группы (настройки) или имени пользователя панели; отображаемое имя единственной строки vless — по сценарию («Нет подключений», «Только Cripto», «Отключите HWID», «Превышен лимит HWID»). Query t= опционален. Прокси Nuxt добавляет via=crypto-page на секретном пути. Логи PanelUserAccessLog при известном panelUserId.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Тело: base64 (UTF-8): полная подписка или заглушка («Нет подключений» / «Отключите HWID» / «Превышен лимит HWID»).',
  })
  @ApiResponse({
    status: 403,
    description:
      'Пользователь найден, передан непустой query t=, но он не совпадает с токеном подписки (устаревшая или поддельная ссылка).',
  })
  async getPublicSubscription(
    @Param('code') code: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = await this.managementService.findPanelUserByCode(code);

    if (user) {
      const accessToken =
        await this.managementService.ensureSubscriptionAccessToken(user.id);
      const rawT = req.query['t'];
      const providedT =
        typeof rawT === 'string'
          ? rawT
          : Array.isArray(rawT) && typeof rawT[0] === 'string'
            ? rawT[0]
            : undefined;
      const trimmedT = (providedT ?? '').trim();
      if (
        trimmedT.length > 0 &&
        !this.managementService.subscriptionFetchTokenMatches(
          trimmedT,
          accessToken,
        )
      ) {
        res.status(403);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader(
          'Cache-Control',
          'private, no-store, no-cache, must-revalidate, max-age=0',
        );
        res.setHeader('Pragma', 'no-cache');
        return res.send(
          'Параметр t= указан, но неверен или устарел. Возьмите актуальную ссылку (happ:// crypto) или откройте подписку без параметра t.',
        );
      }
    }

    const rawVia = req.query['via'];
    const viaCryptoPage =
      rawVia === 'crypto-page' ||
      (Array.isArray(rawVia) && rawVia[0] === 'crypto-page');

    const uaHeader = req.headers['user-agent'];
    const ua =
      typeof uaHeader === 'string'
        ? uaHeader.trim()
        : Array.isArray(uaHeader) && uaHeader[0]
          ? String(uaHeader[0]).trim()
          : '';

    let subscriptionProfileTitle = 'Нет подключений';
    if (user) {
      subscriptionProfileTitle =
        await this.managementService.resolveSubscriptionProfileTitleForPanelUser(
          user,
        );
    }

    let payload: {
      encoded: string;
      profileTitle: string;
      panelUserId: string | null;
    };

    if (!user) {
      payload = this.managementService.buildNoConnectionsPlaceholderFeed(
        null,
        code,
      );
    } else if (!user.enabled) {
      payload = this.managementService.buildNoConnectionsPlaceholderFeed(
        user.id,
        user.code,
        subscriptionProfileTitle,
      );
    } else if (user.cryptoOnlySubscription === true && !viaCryptoPage) {
      payload = this.managementService.buildNamedSubscriptionPlaceholderFeed(
        user.id,
        user.code,
        subscriptionProfileTitle,
        'Только Cripto',
      );
    } else {
      const allowAll = user.allowAllUserAgents === true;
      const requireHwid = user.requireHwid === true;
      const requireNoHwid = user.requireNoHwid === true;
      if (!allowAll && !ua.startsWith('Happ')) {
        payload = this.managementService.buildNoConnectionsPlaceholderFeed(
          user.id,
          user.code,
          subscriptionProfileTitle,
        );
      } else if (requireNoHwid && hasSubscriptionHwid(req)) {
        payload = this.managementService.buildNamedSubscriptionPlaceholderFeed(
          user.id,
          user.code,
          subscriptionProfileTitle,
          'Отключите HWID',
        );
      } else if (requireHwid && !hasSubscriptionHwid(req)) {
        payload = this.managementService.buildNoConnectionsPlaceholderFeed(
          user.id,
          user.code,
          subscriptionProfileTitle,
        );
      } else if (
        requireNoHwid !== true &&
        (user.maxUniqueHwids ?? 0) > 0 &&
        (await this.managementService.isUniqueHwidLimitExceeded(
          user.id,
          user.maxUniqueHwids ?? 0,
          requireNoHwid,
          extractSubscriptionAccessMeta(req).hwid,
        ))
      ) {
        payload = this.managementService.buildNamedSubscriptionPlaceholderFeed(
          user.id,
          user.code,
          subscriptionProfileTitle,
          'Превышен лимит HWID',
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
    setHappHideSettingsHeader(res);
    if (payload.profileTitle) {
      setProfileTitleResponseHeaders(res, payload.profileTitle);
    }
    res.send(payload.encoded);
  }
}

