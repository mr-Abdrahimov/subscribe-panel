/**
 * Стабильный ключ для сопоставления строк подписки с коннектом в БД.
 *
 * Устраняет расхождения между повторными загрузками:
 * — порядок query (собственный разбор строки, не только URLSearchParams);
 * — регистр имён и значений enum-параметров;
 * — неявный порт 443 у vless/vmess/trojan vs явный :443;
 * — повторное процент-кодирование в значениях;
 * — пустые значения параметров (не попадают в ключ);
 * — NFC для query/userinfo (кириллица NFD vs NFC);
 * — «сломанный» # внутри query (например remark=… #5&security=tls) → экранируем как %23;
 * — фрагмент #… в конце строки не входит в ключ.
 * — для vLESS убираем из ключа параметры, совпадающие с дефолтами клиентов (encryption=none,
 *   headerType=none при type=tcp), чтобы одна и та же нода не плодилась при разном оформлении URI.
 * — для vLESS параметр sid (Reality short_id) не входит в ключ: на части панелей он выдаётся случайно.
 *
 * Если WHATWG URL не парсит строку — сохраняем регистр хвоста (ss/vmess base64).
 */

/**
 * Подготовка URI перед разбором (и для identity, и для извлечения названия).
 * Чинит незакодированный # в query, из‑за которого URL считает фрагментом хвост и «теряет» параметры.
 */
export function prepareConnectUriForParse(raw: string): string {
  let s = raw.trim().normalize('NFC');
  s = repairMalformedHashInQuery(s);
  return s;
}

/**
 * Если после «?» встречается «#», а хвост похож на продолжение query (…&param=),
 * этот # с высокой вероятностью часть значения (например «списки #5»), а не начало фрагмента.
 */
function repairMalformedHashInQuery(s: string): string {
  const q = s.indexOf('?');
  if (q < 0) {
    return s;
  }
  let i = s.indexOf('#', q);
  while (i >= 0) {
    const fragment = s.slice(i + 1);
    if (/^[0-9A-Za-z._-]*&[a-zA-Z0-9._-]+=/.test(fragment)) {
      s = `${s.slice(0, i)}%23${fragment}`;
      i = s.indexOf('#', q);
      continue;
    }
    break;
  }
  return s;
}

export function normalizedConnectIdentity(raw: string): string {
  const prepared = prepareConnectUriForParse(raw);
  const hashIdx = prepared.indexOf('#');
  const base = hashIdx >= 0 ? prepared.slice(0, hashIdx) : prepared;

  try {
    const u = new URL(base);
    return buildIdentityFromUrl(u);
  } catch {
    return identityFallbackBase(base);
  }
}

function buildIdentityFromUrl(u: URL): string {
  const protocol = u.protocol.replace(/:$/, '').toLowerCase();

  let hostname = u.hostname.toLowerCase();
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1).toLowerCase();
  }

  let port = u.port;
  if (
    !port &&
    (protocol === 'vless' || protocol === 'vmess' || protocol === 'trojan')
  ) {
    port = '443';
  }

  let pathname = u.pathname || '';
  if (pathname === '/' || pathname === '') {
    pathname = '';
  } else {
    pathname = pathname.replace(/\/+$/, '');
  }

  const userDecoded =
    u.username !== ''
      ? safeDecodeURIComponent(u.username).normalize('NFC')
      : '';
  const passDecoded =
    u.password !== ''
      ? safeDecodeURIComponent(u.password).normalize('NFC')
      : '';
  const userinfo =
    userDecoded !== ''
      ? `${normalizeUserinfoUser(userDecoded, protocol)}${
          passDecoded !== '' ? ':' + passDecoded : ''
        }@`
      : '';

  let search = canonicalSearchFromUrlSearch(u.search);
  if (protocol === 'vless') {
    search = stripRedundantVlessIdentityQuery(search);
  }

  const hostPart = port ? `${hostname}:${port}` : hostname;
  return `${protocol}://${userinfo}${hostPart}${pathname}${search}`;
}

/**
 * После канонизации query: убрать параметры, которые одни клиенты пишут в URI, другие опускают,
 * хотя для VLESS это одно и то же (типичный источник ложных «новых» коннектов при синке).
 */
function stripRedundantVlessIdentityQuery(canonicalQuery: string): string {
  if (!canonicalQuery || canonicalQuery === '?') {
    return canonicalQuery;
  }
  const qs = canonicalQuery.startsWith('?')
    ? canonicalQuery.slice(1)
    : canonicalQuery;
  const byKey = new Map<string, string[]>();
  for (const segment of qs.split('&')) {
    if (!segment) {
      continue;
    }
    const eq = segment.indexOf('=');
    const k =
      eq >= 0
        ? safeDecodeURIComponent(segment.slice(0, eq)).trim().toLowerCase()
        : '';
    const v = eq >= 0 ? safeDecodeURIComponent(segment.slice(eq + 1)) : '';
    if (!k) {
      continue;
    }
    if (!byKey.has(k)) {
      byKey.set(k, []);
    }
    byKey.get(k)!.push(v);
  }

  const typeLower = (byKey.get('type')?.[0] ?? '').trim().toLowerCase();

  const enc = byKey.get('encryption')?.[0]?.trim().toLowerCase();
  if (enc === 'none') {
    byKey.delete('encryption');
  }

  const ht = byKey.get('headertype')?.[0]?.trim().toLowerCase();
  if (ht === 'none' && typeLower === 'tcp') {
    byKey.delete('headertype');
  }

  /** Часть клиентов пишет serverName= вместо sni= при том же значении. */
  const sniVals = byKey.get('sni');
  const serverNameVals = byKey.get('servername');
  if (serverNameVals?.length) {
    const s0 = (sniVals?.[0] ?? '').trim().toLowerCase();
    const n0 = (serverNameVals[0] ?? '').trim().toLowerCase();
    if (!sniVals?.length || s0 === n0) {
      byKey.set('sni', sniVals?.length ? sniVals : serverNameVals);
      byKey.delete('servername');
    }
  }

  /** Reality short_id часто рандомизируется при каждой выдаче подписки — не сравниваем. */
  byKey.delete('sid');

  const sortedKeys = [...byKey.keys()].sort((a, b) => a.localeCompare(b));
  const pairs: string[] = [];
  for (const lk of sortedKeys) {
    const vals = [...byKey.get(lk)!].sort((a, b) => a.localeCompare(b));
    for (const val of vals) {
      pairs.push(`${encodeURIComponent(lk)}=${encodeURIComponent(val)}`);
    }
  }
  return pairs.length ? `?${pairs.join('&')}` : '';
}

/**
 * Каноническая query из того, что отдаёт URL.search (?… или пусто).
 * Разбор вручную + многошаговое decode, чтобы совпадали разные порядки и кодирование.
 */
function canonicalSearchFromUrlSearch(search: string): string {
  const qs = search.startsWith('?') ? search.slice(1) : search;
  if (!qs.trim()) {
    return '';
  }

  const byKey = new Map<string, string[]>();
  for (const segment of qs.split('&')) {
    if (!segment) {
      continue;
    }
    const eq = segment.indexOf('=');
    const kEnc = eq >= 0 ? segment.slice(0, eq) : segment;
    const vEnc = eq >= 0 ? segment.slice(eq + 1) : '';
    const k = multiDecodeFormValue(kEnc).trim().toLowerCase().normalize('NFC');
    const v = multiDecodeFormValue(vEnc).normalize('NFC');
    if (!k) {
      continue;
    }
    if (!byKey.has(k)) {
      byKey.set(k, []);
    }
    byKey.get(k)!.push(v);
  }

  const sortedKeys = [...byKey.keys()].sort((a, b) => a.localeCompare(b));
  const pairs: string[] = [];
  for (const lk of sortedKeys) {
    const vals = [...byKey.get(lk)!].sort((a, b) => a.localeCompare(b));
    for (const v0 of vals) {
      const v = normalizeQueryValueForIdentity(lk, v0);
      if (v === '') {
        continue;
      }
      pairs.push(`${encodeURIComponent(lk)}=${encodeURIComponent(v)}`);
    }
  }
  return pairs.length ? `?${pairs.join('&')}` : '';
}

function multiDecodeFormValue(s: string): string {
  let out = s.replace(/\+/g, ' ');
  for (let i = 0; i < 5; i += 1) {
    try {
      const next = decodeURIComponent(out);
      if (next === out) {
        break;
      }
      out = next;
    } catch {
      break;
    }
  }
  return out;
}

/** Без URL(): не приводим весь хвост к lowerCase (base64 в ss/vmess). */
function identityFallbackBase(base: string): string {
  const b = base.trim().normalize('NFC'); // base уже из prepared; NFC на всякий случай
  const m = b.match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i);
  if (!m) {
    return b.replace(/\s+/g, '');
  }
  const scheme = m[1].toLowerCase();
  const rest = m[2].replace(/\s+/g, '');
  return `${scheme}://${rest}`;
}

const BOOLISH_PARAM_KEYS = new Set([
  'mux',
  'allowinsecure',
  'insecure',
  'udp',
  'edgetunnel',
  'packetencoding',
]);

function normalizeQueryValueForIdentity(keyLower: string, v: string): string {
  const t = v.trim().normalize('NFC');
  if (!t) {
    return '';
  }

  if (BOOLISH_PARAM_KEYS.has(keyLower)) {
    const low = t.toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(low)) {
      return '1';
    }
    if (['false', '0', 'no', 'off'].includes(low)) {
      return '0';
    }
  }

  if (
    [
      'sni',
      'host',
      'peer',
      'servername',
      'remotehost',
      'alpn',
      'servicename',
    ].includes(keyLower) ||
    keyLower.endsWith('host')
  ) {
    return t
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .join(',');
  }

  if (keyLower === 'path' || keyLower === 'servicepath') {
    try {
      return multiDecodeFormValue(t).replace(/\s+/g, '').toLowerCase();
    } catch {
      return t.replace(/\s+/g, '').toLowerCase();
    }
  }

  if (/^[A-Za-z0-9._~-]+$/.test(t) && t.length <= 256) {
    return t.toLowerCase();
  }

  return t;
}

function normalizeUserinfoUser(user: string, protocol: string): string {
  const t = user.trim();
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)
  ) {
    return t.toLowerCase();
  }
  if (protocol === 'trojan' || protocol === 'ss') {
    return t;
  }
  return t;
}

function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Параметры, определяющие конечную точку и криптонастройки VLESS (Reality/TLS/WS и т.д.).
 * Намеренно без fp, encryption, headerType, utls, remark и пр. — они меняются между клиентами
 * при той же ноде и ломали строгий ключ, из‑за чего коннект пересоздавался и терялись groupNames.
 */
const VLESS_CORE_QUERY_KEYS = new Set([
  'type',
  'security',
  'flow',
  'sni',
  'host',
  'servername',
  'pbk',
  'path',
  'servicepath',
  'alpn',
  'servicename',
  'mode',
]);

/**
 * Вторичный ключ только для сопоставления при синке подписки с уже существующей записью Connect.
 * Не заменяет normalizedConnectIdentity для identityKey в БД.
 */
export function vlessCoreIdentityForMatching(raw: string): string | null {
  const prepared = prepareConnectUriForParse(raw);
  const hashIdx = prepared.indexOf('#');
  const base = hashIdx >= 0 ? prepared.slice(0, hashIdx) : prepared;
  try {
    const u = new URL(base);
    const protocol = u.protocol.replace(/:$/, '').toLowerCase();
    if (protocol !== 'vless') {
      return null;
    }

    let hostname = u.hostname.toLowerCase();
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1).toLowerCase();
    }
    let port = u.port;
    if (!port) {
      port = '443';
    }

    let pathname = u.pathname || '';
    if (pathname === '/' || pathname === '') {
      pathname = '';
    } else {
      pathname = pathname.replace(/\/+$/, '');
    }

    const userDecoded =
      u.username !== ''
        ? safeDecodeURIComponent(u.username).normalize('NFC')
        : '';
    const passDecoded =
      u.password !== ''
        ? safeDecodeURIComponent(u.password).normalize('NFC')
        : '';
    const userinfo =
      userDecoded !== ''
        ? `${normalizeUserinfoUser(userDecoded, protocol)}${
            passDecoded !== '' ? ':' + passDecoded : ''
          }@`
        : '';

    const qs = u.search.startsWith('?') ? u.search.slice(1) : u.search;
    const byKey = new Map<string, string[]>();
    for (const segment of qs.split('&')) {
      if (!segment) {
        continue;
      }
      const eq = segment.indexOf('=');
      const kEnc = eq >= 0 ? segment.slice(0, eq) : segment;
      const vEnc = eq >= 0 ? segment.slice(eq + 1) : '';
      const k = multiDecodeFormValue(kEnc).trim().toLowerCase().normalize('NFC');
      const v = multiDecodeFormValue(vEnc).normalize('NFC');
      if (!k || !VLESS_CORE_QUERY_KEYS.has(k)) {
        continue;
      }
      if (!byKey.has(k)) {
        byKey.set(k, []);
      }
      byKey.get(k)!.push(v);
    }

    const sniVals = byKey.get('sni');
    const serverNameVals = byKey.get('servername');
    if (serverNameVals?.length) {
      const s0 = (sniVals?.[0] ?? '').trim().toLowerCase();
      const n0 = (serverNameVals[0] ?? '').trim().toLowerCase();
      if (!sniVals?.length || s0 === n0) {
        byKey.set('sni', sniVals?.length ? sniVals : serverNameVals);
        byKey.delete('servername');
      }
    }

    const sortedKeys = [...byKey.keys()].sort((a, b) => a.localeCompare(b));
    const pairs: string[] = [];
    for (const lk of sortedKeys) {
      const vals = [...byKey.get(lk)!].sort((a, b) => a.localeCompare(b));
      for (const v0 of vals) {
        const v = normalizeQueryValueForIdentity(lk, v0);
        if (v === '') {
          continue;
        }
        pairs.push(`${encodeURIComponent(lk)}=${encodeURIComponent(v)}`);
      }
    }
    const search = pairs.length ? `?${pairs.join('&')}` : '';
    const hostPart = `${hostname}:${port}`;
    return `vless://${userinfo}${hostPart}${pathname}${search}`;
  } catch {
    return null;
  }
}
