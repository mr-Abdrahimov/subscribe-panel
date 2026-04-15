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
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  setHappRoutingResponseHeader,
  setAllSubscriptionProfileHeaders,
} from '../common/profile-title-header';
import {
  extractSubscriptionAccessMeta,
  hasSubscriptionHwid,
} from '../common/subscription-client-meta';
import { CreateGroupDto } from './dto/create-group.dto';
import { ReorderGroupsDto } from './dto/reorder-groups.dto';
import { CreateSubscriptionAppLinkDto } from './dto/create-subscription-app-link.dto';
import { UpdateGroupSettingsDto } from './dto/update-group-settings.dto';
import { BulkUpdatePanelUsersDto } from './dto/bulk-update-panel-users.dto';
import { CreatePanelUserDto } from './dto/create-panel-user.dto';
import { PublicSubscriptionGroupPrefsDto } from './dto/public-subscription-group-prefs.dto';
import { UpdatePanelUserDto } from './dto/update-panel-user.dto';
import { UpdateSubscriptionAppLinkDto } from './dto/update-subscription-app-link.dto';
import { TelegramTestMessageDto } from './dto/telegram-test-message.dto';
import { UpdatePanelGlobalSettingsDto } from './dto/update-panel-global-settings.dto';
import { ManagementService } from './management.service';

@ApiTags('Управление')
@Controller()
export class ManagementController {
  private readonly logger = new Logger(ManagementController.name);

  constructor(private readonly managementService: ManagementService) {}

  @Get('panel-global-settings')
  @ApiOperation({
    summary: 'Получить глобальные настройки панели',
    description:
      'Значения по умолчанию для объявления и интервала автообновления Happ: используются в GET /public/sub/:code, если у соответствующей группы пользователя поля не заданы (наследование). Пер-групповые значения настраиваются в PATCH /groups/:id. Также настройки Telegram (токен бота и id группы для уведомлений) и поле routingConfig (текст маршрутизации, хранится в панели).',
  })
  getPanelGlobalSettings() {
    return this.managementService.getPanelGlobalSettings();
  }

  @Patch('panel-global-settings')
  @ApiOperation({
    summary: 'Обновить глобальные настройки панели',
    description:
      'Частичное обновление значений по умолчанию: subscriptionAnnounce (до 200 символов; пустая строка — отключить в глобальных настройках); profileUpdateInterval (часы 1–8760; null — отключить); telegramBotSecret и telegramGroupId (пустая строка — сбросить); routingConfig (до 8000 символов; пустая строка — сбросить). Для пользователей группы с собственными полями в PATCH /groups/:id приоритет у настроек группы. Не переданные поля не меняются.',
  })
  @ApiResponse({
    status: 200,
    description: 'Текущие настройки после сохранения',
  })
  updatePanelGlobalSettings(@Body() body: UpdatePanelGlobalSettingsDto) {
    return this.managementService.updatePanelGlobalSettings(body);
  }

  @Post('panel-global-settings/telegram-test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Отправить тестовое сообщение в Telegram',
    description:
      'Использует сохранённые в панели telegramBotSecret и telegramGroupId. Тело опционально: поле text — текст сообщения (иначе стандартная фраза).',
  })
  @ApiResponse({
    status: 200,
    description: 'Сообщение отправлено, в ответе messageId из Telegram',
  })
  @ApiResponse({
    status: 400,
    description: 'Не заданы секрет/chat id или ошибка Telegram API',
  })
  sendTelegramTest(@Body() body: TelegramTestMessageDto) {
    return this.managementService.sendTelegramTestMessage(body.text);
  }

  @Get('groups')
  @ApiOperation({
    summary: 'Получить список групп',
    description:
      'Группы отсортированы по полю sortOrder (порядок в панели). Поле isMainGroup — «главная» группа: у одного коннекта не может быть двух таких групп одновременно (PATCH connects/:id/groups). В каждом элементе: activeConnectCount — число активных коннектов с этой группой в groupNames; panelUserCount — число пользователей панели, у которых группа входит в groupNames. Служебная группа «Без группы» при отсутствии в БД создаётся автоматически; новые коннекты из «Подписки» без тегов получают эту группу.',
  })
  listGroups() {
    return this.managementService.listGroups();
  }

  @Post('groups')
  @ApiOperation({
    summary: 'Создать группу',
    description:
      'Имя группы обязательно; имя «Без группы» недопустимо (зарезервировано). Опционально: isMainGroup (главная — не более одной на коннект), subscriptionDisplayName, subscriptionAnnounce, profileUpdateInterval (часы). Пустые/null для объявления и интервала — наследование из глобальных настроек панели.',
  })
  createGroup(@Body() body: CreateGroupDto) {
    return this.managementService.createGroup(body);
  }

  @Patch('groups/reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Изменить порядок групп',
    description:
      'Массив ID всех групп в требуемом порядке. Длина и набор идентификаторов должны совпадать с группами в базе.',
  })
  @ApiResponse({ status: 200, description: 'Порядок сохранён' })
  @ApiResponse({ status: 400, description: 'Некорректный список ID' })
  reorderGroups(@Body() body: ReorderGroupsDto) {
    return this.managementService.reorderGroups(body.ids);
  }

  @Delete('groups/:id')
  @ApiOperation({
    summary: 'Удалить группу',
    description: 'Служебную группу «Без группы» удалить нельзя.',
  })
  removeGroup(@Param('id') id: string) {
    return this.managementService.deleteGroup(id);
  }

  @Patch('groups/:id')
  @ApiOperation({
    summary: 'Обновить настройки группы',
    description:
      'Частичное обновление. name — смена уникального имени группы (теги groupNames у коннектов и пользователей панели обновляются); группу «Без группы» переименовать нельзя, на это имя переименовать другую группу тоже нельзя. isMainGroup — флаг главной группы для коннектов (нельзя включить для «Без группы»; у коннекта не более одной главной группы). subscriptionDisplayName — название профиля для этой группы ( /sub, profile-title ленты). subscriptionAnnounce и profileUpdateInterval — объявление и интервал Happ для пользователей, у которых эта группа выбрана первой в порядке (сначала PanelUser.groupNames (порядок в массиве), затем прочие группы ленты); null или пустая строка для объявления — наследование из глобальных настроек панели. Строки ленты (#) — из name коннекта.',
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
      'В каждом элементе: lastSubscriptionActivityAt — последний GET /public/sub/:code с выдачей полной ленты (не заглушки); subscriptionUniqueHwidCount — уникальные HWID только среди успешных выдач; maxUniqueHwids — настраиваемый лимит (0 = не ограничивать).',
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
  createUser(@Body() body: CreatePanelUserDto) {
    return this.managementService.createUser(
      body.name,
      body.code,
      body.groupNames,
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
      'По списку ids: groupName без restrict — список групп пользователя заменяется одной группой; с restrictToCurrentGroupName — перенос из группы в другую; addGroupName — добавить группу к списку; removeGroupName — убрать группу (у пользователя должна остаться хотя бы одна группа). Также: enabled, allowAllUserAgents, maxUniqueHwids, cryptoOnlySubscription, очистка логов подписки (PanelUserAccessLog). Требуется хотя бы одно действие.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Объект { updated: число обновлённых записей PanelUser, deletedLogs: число удалённых логов }',
  })
  @ApiResponse({
    status: 400,
    description: 'Некорректные данные или группа не найдена',
  })
  bulkUpdatePanelUsers(@Body() body: BulkUpdatePanelUsersDto) {
    return this.managementService.bulkUpdatePanelUsers(body);
  }

  @Patch('panel-users/:id')
  @ApiOperation({
    summary: 'Обновить пользователя панели',
    description:
      'Частичное обновление: enabled, name, code (код в /sub/…; при изменении заново запрашивается happ:// для Happ), groupNames (полная замена списка групп), allowAllUserAgents, requireHwid, requireNoHwid, maxUniqueHwids, cryptoOnlySubscription. Если code не передан — прежний код сохраняется.',
  })
  @ApiResponse({ status: 200, description: 'Пользователь успешно обновлён' })
  @ApiResponse({
    status: 400,
    description: 'Некорректные данные или группа не найдена',
  })
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
    description:
      'Не удалось получить ссылку (сервис crypto или настройки URL подписки)',
  })
  @ApiResponse({ status: 404, description: 'Пользователь не найден' })
  createPanelUserHappCrypto(@Param('id') id: string) {
    return this.managementService.createHappCryptoUrlForPanelUser(id);
  }

  @Get('panel-users/:id/subscription-access-logs')
  @ApiOperation({
    summary: 'Логи обращений к подписке пользователя панели',
    description:
      'Записи PanelUserAccessLog при GET /public/sub/:code: IP, User-Agent, HWID (если передан), query, success (полная лента или заглушка-отказ) и доп. заголовки. Сортировка по убыванию времени. Параметр limit — от 1 до 500, по умолчанию 200. Параметр hwid (опционально) — отфильтровать записи с точным совпадением HWID. В ответе поле hwids — список уникальных непустых HWID по всем логам пользователя.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Объект: user (name, code), hwids — массив строк HWID, logs — массив записей.',
  })
  @ApiResponse({ status: 404, description: 'Пользователь не найден' })
  listSubscriptionAccessLogs(
    @Param('id') id: string,
    @Query('limit') limitRaw?: string,
    @Query('hwid') hwid?: string,
  ) {
    const parsed = parseInt(limitRaw ?? '', 10);
    const limit = Number.isNaN(parsed)
      ? 200
      : Math.min(500, Math.max(1, parsed));
    return this.managementService.listPanelUserSubscriptionAccessLogs(
      id,
      limit,
      hwid,
    );
  }

  @Delete('panel-users/:id/subscription-access-logs')
  @ApiOperation({
    summary: 'Очистить логи обращений к подписке',
    description:
      'Без query-параметра hwid — удаляет все записи PanelUserAccessLog пользователя. С параметром hwid — только записи с точным совпадением HWID (строка как в БД). Счётчики уникальных HWID и последней активности обновятся после перезагрузки списка пользователей.',
  })
  @ApiResponse({
    status: 200,
    description: 'Объект { deleted: число удалённых записей }',
  })
  @ApiResponse({ status: 400, description: 'Передан пустой hwid' })
  @ApiResponse({ status: 404, description: 'Пользователь не найден' })
  clearSubscriptionAccessLogs(
    @Param('id') id: string,
    @Query('hwid') hwid?: string,
  ) {
    const t = hwid?.trim();
    if (t) {
      return this.managementService.deletePanelUserSubscriptionAccessLogsByHwid(
        id,
        t,
      );
    }
    return this.managementService.deleteAllPanelUserSubscriptionAccessLogs(id);
  }

  @Patch('connects/:id/groups')
  @ApiOperation({
    summary: 'Назначить группы коннекту',
    description:
      'Полный список groupNames. Не допускается больше одной группы с флагом isMainGroup (главная) одновременно — иначе 400. Пустой список превращается в служебную группу «Без группы». Если в списке есть «Без группы» и ещё хотя бы одна группа, тег «Без группы» удаляется (коннект считается распределённым).',
  })
  setConnectGroups(
    @Param('id') id: string,
    @Body() body: { groupNames: string[] },
  ) {
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
  @ApiResponse({
    status: 400,
    description: 'Пустое название или пустая ссылка',
  })
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
  @Header(
    'Cache-Control',
    'private, no-store, no-cache, must-revalidate, max-age=0',
  )
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary: 'Получить публичную информацию пользователя по коду',
    description:
      'Поле profileTitle — subscriptionDisplayName группы (заголовок ленты). Поле groups — расширенный список тегов для справки. subscriptionGroups — порядок групп пользователя и флаг include (в ленту); сохранение через PATCH …/subscription-group-prefs (по коду страницы). groupActiveConnectCountByName — объект «имя группы → число активных коннектов с этим тегом» (как при сборке ленты /public/sub: ACTIVE и groupNames содержит имя). happCryptoUrl — happ:// для импорта. Массив appLinks.',
  })
  getPublicUser(@Param('code') code: string) {
    return this.managementService.getPublicUserByCode(code);
  }

  @Patch('public/users/:code/subscription-group-prefs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Сохранить порядок групп и включение коннектов в ленту',
    description:
      'Публичный эндпоинт по коду персональной страницы пользователя. Тело: полный список групп пользователя в нужном порядке, у каждой — include (показывать коннекты группы в подписке).',
  })
  @ApiResponse({
    status: 200,
    description: 'Сохранено; в ответе актуальный массив subscriptionGroups',
  })
  @ApiResponse({
    status: 400,
    description: 'Список групп не совпадает с groupNames пользователя',
  })
  saveSubscriptionGroupPrefs(
    @Param('code') code: string,
    @Body() body: PublicSubscriptionGroupPrefsDto,
  ) {
    return this.managementService.savePublicSubscriptionGroupPrefs(
      code,
      body.groups,
    );
  }

  @Get('public/sub/:code')
  @ApiOperation({
    summary: 'Получить base64-подписку по коду пользователя',
    description:
      'Тело всегда base64(UTF-8). Всегда присутствует строка #profile-web-page-url: абсолютный URL страницы …/sub/CODE (FRONTEND_ORIGIN). Для Happ: #hide-settings в теле и заголовок hide-settings. Если в глобальных настройках панели задано поле routingConfig — в ответ добавляется HTTP-заголовок routing (первая непустая строка) и те же строки в начале тела подписки до base64 (документация Happ: геонастройки / routing). Строки #announce / announce и #profile-update-interval / profile-update-interval берутся из первой подходящей группы пользователя (сначала группы из PanelUser.groupNames по порядку, затем остальные группы ленты) с наследованием незаполненных полей из глобальных настроек панели; для известного пользователя к тексту объявления с новой строки добавляется «Отображаются: …» (группы по персональным настройкам подписки; у каждой группы в скобках — число активных коннектов с этим тегом, как в ленте); строка «Не отображаются: …» с тем же форматом имён и чисел добавляется только если есть хотя бы одна группа, скрытая из ленты; усечение до лимита Happ (200 символов); для неизвестного кода — только глобальные настройки (документация Happ app-management). Заглушки: #profile-title и заголовок profile-title — из subscriptionDisplayName группы (настройки) или имени пользователя панели; отображаемое имя единственной строки vless — по сценарию («Нет подключений», «Только Cripto», «Отключите HWID», «Превышен лимит HWID»). Query t= опционален. Прокси Nuxt добавляет via=crypto-page на секретном пути. При известном panelUserId запись в PanelUserAccessLog: success=false для заглушек (не учитывается в лимите HWID и активности), success=true для полной ленты. При включённом TELEGRAM_NOTIFY_SUBSCRIPTION_ACCESS (по умолчанию) и настроенных в панели Telegram — в очередь subscription-access-notify ставится задача только при первом успешном получении ленты с новым непустым HWID для данного пользователя панели (как при подсчёте уникальных HWID); сообщение в чат бесшумно (disable_notification).',
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

    let subscriptionProfileTitle = '❌ Ошибка: Нет подключений 1';
    if (user) {
      subscriptionProfileTitle =
        await this.managementService.resolveSubscriptionProfileTitleForPanelUser(
          user,
        );
    }

    const {
      announceMetaLine,
      profileUpdateIntervalMetaLine,
      profileUpdateIntervalHours,
      routingConfig,
    } = await this.managementService.getSubscriptionMetaForPublicSub(user);

    let payload: {
      encoded?: string;
      jsonBody?: string;
      profileTitle: string;
      profileWebPageUrl?: string;
      panelUserId: string | null;
      subscriptionDelivered: boolean;
    };

    if (!user) {
      payload = this.managementService.buildNoConnectionsPlaceholderFeed(
        null,
        code,
        '❌ Ошибка: Нет подключений 2',
        announceMetaLine,
        profileUpdateIntervalMetaLine,
        routingConfig,
      );
    } else if (!user.enabled) {
      payload = this.managementService.buildNoConnectionsPlaceholderFeed(
        user.id,
        user.code,
        subscriptionProfileTitle,
        announceMetaLine,
        profileUpdateIntervalMetaLine,
        routingConfig,
      );
    } else if (user.cryptoOnlySubscription === true && !viaCryptoPage) {
      payload = this.managementService.buildNamedSubscriptionPlaceholderFeed(
        user.id,
        user.code,
        subscriptionProfileTitle,
        '❌ Ошибка: Режим Только Cripto',
        announceMetaLine,
        profileUpdateIntervalMetaLine,
        routingConfig,
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
          announceMetaLine,
          profileUpdateIntervalMetaLine,
          routingConfig,
        );
      } else if (requireNoHwid && hasSubscriptionHwid(req)) {
        payload = this.managementService.buildNamedSubscriptionPlaceholderFeed(
          user.id,
          user.code,
          subscriptionProfileTitle,
          '❌ Ошибка: Отключите HWID',
          announceMetaLine,
          profileUpdateIntervalMetaLine,
          routingConfig,
        );
      } else if (requireHwid && !hasSubscriptionHwid(req)) {
        payload = this.managementService.buildNoConnectionsPlaceholderFeed(
          user.id,
          user.code,
          subscriptionProfileTitle,
          announceMetaLine,
          profileUpdateIntervalMetaLine,
          routingConfig,
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
          '❌ Ошибка: Превышен лимит устройств',
          announceMetaLine,
          profileUpdateIntervalMetaLine,
          routingConfig,
        );
      } else if (viaCryptoPage && user.feedJsonMode === true) {
        const userinfo = await this.managementService.resolveSubscriptionUserinfoForPanelUser(user);
        payload = await this.managementService.buildJsonFeedForPanelUser(
          user,
          announceMetaLine,
          userinfo?.expiresAt ?? null,
        );
      } else {
        payload = await this.managementService.buildPublicFeedForPanelUser(
          user,
          announceMetaLine,
          profileUpdateIntervalMetaLine,
          routingConfig,
        );
      }
    }

    if (payload.panelUserId) {
      try {
        await this.managementService.logPanelUserSubscriptionAccess(
          payload.panelUserId,
          extractSubscriptionAccessMeta(req),
          payload.subscriptionDelivered,
        );
      } catch (err) {
        this.logger.warn(
          `Не удалось записать лог обращения к подписке: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Агрегируем subscription-userinfo из подписок пользователя
    const subscriptionUserinfo = user
      ? await this.managementService.resolveSubscriptionUserinfoForPanelUser(user)
      : null;

    res.status(200);
    res.setHeader(
      'Cache-Control',
      'private, no-store, no-cache, must-revalidate, max-age=0',
    );
    res.setHeader('Pragma', 'no-cache');

    // Общие заголовки профиля — одинаково для BASE64 и JSON режимов
    setAllSubscriptionProfileHeaders(res, {
      profileTitle: payload.profileTitle,
      profileWebPageUrl: payload.profileWebPageUrl ?? this.managementService.buildPublicSubPageAbsoluteUrl(user?.code ?? code),
      contentDispositionFilename: payload.profileTitle || (user?.code ?? code),
      announceMetaLine,
      profileUpdateIntervalHours,
      routingConfig,
      subscriptionUserinfo,
    });

    if (payload.jsonBody !== undefined) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.send(payload.jsonBody);
    } else {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(payload.encoded);
    }
  }
}
