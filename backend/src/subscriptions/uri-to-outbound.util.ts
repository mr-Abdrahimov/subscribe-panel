/**
 * Двунаправленная конвертация между proxy-URI и outbound-объектами формата xray/v2ray.
 *
 * uriToOutbound  — URI (vless://, vmess://, trojan://, ss://, hysteria://, hysteria2://, tuic://) → outbound
 * outboundToUri  — outbound (tag:"proxy" из v2ray/Happ конфига) → URI
 *
 * Оба направления необходимы для хранения двух форматов:
 *   raw     — URI-строка для BASE64-ленты
 *   rawJson — JSON-конфиг для JSON-ленты
 */

export interface V2rayOutbound {
  tag: 'proxy';
  protocol: string;
  settings: Record<string, unknown>;
  streamSettings?: Record<string, unknown>;
}

/**
 * Попытка конвертировать URI-строку в outbound-объект.
 * Возвращает null если URI неизвестного формата или не парсится.
 */
export function uriToOutbound(raw: string): V2rayOutbound | null {
  try {
    const scheme = raw.split('://')[0]?.toLowerCase().trim();
    switch (scheme) {
      case 'vless':
        return parseVless(raw);
      case 'vmess':
        return parseVmess(raw);
      case 'trojan':
        return parseTrojan(raw);
      case 'ss':
        return parseShadowsocks(raw);
      case 'hysteria':
        return parseHysteria(raw);
      case 'hysteria2':
      case 'hy2':
        return parseHysteria2(raw);
      case 'tuic':
        return parseTuic(raw);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function qs(url: URL, key: string): string {
  return url.searchParams.get(key) ?? '';
}

function buildStreamSettings(
  url: URL,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const network = qs(url, 'type') || 'tcp';
  const security = qs(url, 'security') || 'none';

  const stream: Record<string, unknown> = { network, security, ...overrides };

  // transport settings
  switch (network) {
    case 'ws': {
      const wsSettings: Record<string, unknown> = {};
      const path = qs(url, 'path');
      if (path) wsSettings['path'] = decodeURIComponent(path);
      const host = qs(url, 'host');
      if (host) wsSettings['headers'] = { Host: host };
      if (Object.keys(wsSettings).length) stream['wsSettings'] = wsSettings;
      break;
    }
    case 'grpc': {
      const serviceName = qs(url, 'serviceName');
      if (serviceName) stream['grpcSettings'] = { serviceName };
      break;
    }
    case 'h2':
    case 'http': {
      const h2Settings: Record<string, unknown> = {};
      const path = qs(url, 'path');
      if (path) h2Settings['path'] = decodeURIComponent(path);
      const host = qs(url, 'host');
      if (host) h2Settings['host'] = [host];
      if (Object.keys(h2Settings).length) stream['httpSettings'] = h2Settings;
      break;
    }
    case 'httpupgrade': {
      const upgradeSettings: Record<string, unknown> = {};
      const path = qs(url, 'path');
      if (path) upgradeSettings['path'] = decodeURIComponent(path);
      const host = qs(url, 'host');
      if (host) upgradeSettings['host'] = host;
      if (Object.keys(upgradeSettings).length) stream['httpupgradeSettings'] = upgradeSettings;
      break;
    }
    case 'xhttp':
    case 'splithttp': {
      const xhttpSettings: Record<string, unknown> = {};
      const path = qs(url, 'path');
      if (path) xhttpSettings['path'] = decodeURIComponent(path);
      const host = qs(url, 'host');
      if (host) xhttpSettings['host'] = host;
      if (Object.keys(xhttpSettings).length) stream['xhttpSettings'] = xhttpSettings;
      break;
    }
    case 'tcp': {
      const headerType = qs(url, 'headerType');
      if (headerType && headerType !== 'none') {
        stream['tcpSettings'] = { header: { type: headerType } };
      }
      break;
    }
  }

  // security settings
  switch (security) {
    case 'tls': {
      const tlsSettings: Record<string, unknown> = {};
      const sni = qs(url, 'sni') || qs(url, 'peer') || url.hostname;
      if (sni) tlsSettings['serverName'] = sni;
      const fp = qs(url, 'fp');
      if (fp) tlsSettings['fingerprint'] = fp;
      const alpn = qs(url, 'alpn');
      if (alpn) tlsSettings['alpn'] = alpn.split(',');
      if (Object.keys(tlsSettings).length) stream['tlsSettings'] = tlsSettings;
      break;
    }
    case 'reality': {
      const realitySettings: Record<string, unknown> = {};
      const sni = qs(url, 'sni') || qs(url, 'serverName');
      if (sni) realitySettings['serverName'] = sni;
      const pk = qs(url, 'pbk') || qs(url, 'publicKey');
      if (pk) realitySettings['publicKey'] = pk;
      const fp = qs(url, 'fp');
      if (fp) realitySettings['fingerprint'] = fp;
      const sid = qs(url, 'sid');
      if (sid) realitySettings['shortId'] = sid;
      const spx = qs(url, 'spx');
      if (spx) realitySettings['spiderX'] = spx;
      if (Object.keys(realitySettings).length) stream['realitySettings'] = realitySettings;
      break;
    }
  }

  return stream;
}

// ─── VLESS ────────────────────────────────────────────────────────────────────

function parseVless(raw: string): V2rayOutbound | null {
  const url = safeUrl(raw);
  if (!url) return null;

  const uuid = url.username;
  const address = url.hostname;
  const port = parseInt(url.port || '443', 10);
  const flow = qs(url, 'flow');
  const encryption = qs(url, 'encryption') || 'none';

  const user: Record<string, unknown> = { id: uuid, encryption };
  if (flow) user['flow'] = flow;

  return {
    tag: 'proxy',
    protocol: 'vless',
    settings: {
      vnext: [{ address, port, users: [user] }],
    },
    streamSettings: buildStreamSettings(url),
  };
}

// ─── VMESS ────────────────────────────────────────────────────────────────────

function parseVmess(raw: string): V2rayOutbound | null {
  // vmess://base64({v,ps,add,port,id,aid,net,type,host,path,tls,sni,...})
  const b64 = raw.replace(/^vmess:\/\//i, '').trim().replace(/=*$/, '');
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }

  const address = String(config['add'] ?? '');
  const port = parseInt(String(config['port'] ?? '443'), 10);
  const uuid = String(config['id'] ?? '');
  const alterId = parseInt(String(config['aid'] ?? '0'), 10);
  const security = String(config['scy'] ?? config['security'] ?? 'auto');

  const user: Record<string, unknown> = { id: uuid, alterId, security };

  const network = String(config['net'] ?? 'tcp');
  const tls = String(config['tls'] ?? '');
  const stream: Record<string, unknown> = {
    network,
    security: tls || 'none',
  };

  // transport
  switch (network) {
    case 'ws': {
      const wsSettings: Record<string, unknown> = {};
      const path = String(config['path'] ?? '/');
      wsSettings['path'] = path;
      const host = String(config['host'] ?? '');
      if (host) wsSettings['headers'] = { Host: host };
      stream['wsSettings'] = wsSettings;
      break;
    }
    case 'grpc':
      stream['grpcSettings'] = { serviceName: String(config['path'] ?? '') };
      break;
    case 'h2':
    case 'http': {
      const h2: Record<string, unknown> = { path: String(config['path'] ?? '/') };
      const host = String(config['host'] ?? '');
      if (host) h2['host'] = [host];
      stream['httpSettings'] = h2;
      break;
    }
  }

  // tls
  if (tls === 'tls') {
    const sni = String(config['sni'] ?? config['host'] ?? address);
    stream['tlsSettings'] = {
      serverName: sni,
      ...(config['fp'] ? { fingerprint: String(config['fp']) } : {}),
      ...(config['alpn'] ? { alpn: String(config['alpn']).split(',') } : {}),
    };
  }

  return {
    tag: 'proxy',
    protocol: 'vmess',
    settings: {
      vnext: [{ address, port, users: [user] }],
    },
    streamSettings: stream,
  };
}

// ─── TROJAN ───────────────────────────────────────────────────────────────────

function parseTrojan(raw: string): V2rayOutbound | null {
  const url = safeUrl(raw);
  if (!url) return null;

  const password = decodeURIComponent(url.username);
  const address = url.hostname;
  const port = parseInt(url.port || '443', 10);

  return {
    tag: 'proxy',
    protocol: 'trojan',
    settings: {
      servers: [{ address, port, password }],
    },
    streamSettings: buildStreamSettings(url),
  };
}

// ─── SHADOWSOCKS ──────────────────────────────────────────────────────────────

function parseShadowsocks(raw: string): V2rayOutbound | null {
  const url = safeUrl(raw);
  if (!url) return null;

  let method: string;
  let password: string;

  if (url.username && url.password) {
    method = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } else {
    // ss://base64(method:password)@host:port
    try {
      const decoded = Buffer.from(url.username, 'base64').toString('utf8');
      const colonIdx = decoded.indexOf(':');
      method = decoded.slice(0, colonIdx);
      password = decoded.slice(colonIdx + 1);
    } catch {
      return null;
    }
  }

  const address = url.hostname;
  const port = parseInt(url.port || '8388', 10);

  return {
    tag: 'proxy',
    protocol: 'shadowsocks',
    settings: {
      servers: [{ address, port, method, password }],
    },
    streamSettings: buildStreamSettings(url),
  };
}

// ─── HYSTERIA ─────────────────────────────────────────────────────────────────

function parseHysteria(raw: string): V2rayOutbound | null {
  const url = safeUrl(raw);
  if (!url) return null;

  const address = url.hostname;
  const port = parseInt(url.port || '443', 10);
  const auth = qs(url, 'auth') || url.username || '';
  const upMbps = parseInt(qs(url, 'upmbps') || '0', 10);
  const downMbps = parseInt(qs(url, 'downmbps') || '0', 10);
  const sni = qs(url, 'peer') || qs(url, 'sni') || address;

  return {
    tag: 'proxy',
    protocol: 'hysteria',
    settings: { address, port, auth, upMbps, downMbps },
    streamSettings: {
      network: 'hysteria',
      hysteriaSettings: { auth },
      security: 'tls',
      tlsSettings: { serverName: sni, alpn: ['h3'] },
    },
  };
}

// ─── HYSTERIA2 ────────────────────────────────────────────────────────────────

function parseHysteria2(raw: string): V2rayOutbound | null {
  const normalized = raw.replace(/^hy2:\/\//i, 'hysteria2://');
  const url = safeUrl(normalized);
  if (!url) return null;

  const address = url.hostname;
  const port = parseInt(url.port || '443', 10);
  const auth = decodeURIComponent(url.username || url.password || '');
  const sni = qs(url, 'sni') || address;
  const obfs = qs(url, 'obfs');
  const obfsPassword = qs(url, 'obfs-password');

  const settings: Record<string, unknown> = { address, port, version: 2 };
  if (auth) settings['auth'] = auth;
  if (obfs) settings['obfs'] = obfs;
  if (obfsPassword) settings['obfsPassword'] = obfsPassword;

  return {
    tag: 'proxy',
    protocol: 'hysteria2',
    settings,
    streamSettings: {
      network: 'hysteria',
      hysteriaSettings: { version: 2, ...(auth ? { auth } : {}) },
      security: 'tls',
      tlsSettings: { serverName: sni, alpn: ['h3'] },
    },
  };
}

// ─── TUIC ─────────────────────────────────────────────────────────────────────

function parseTuic(raw: string): V2rayOutbound | null {
  const url = safeUrl(raw);
  if (!url) return null;

  const uuid = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const address = url.hostname;
  const port = parseInt(url.port || '443', 10);
  const sni = qs(url, 'sni') || address;
  const alpn = qs(url, 'alpn') || 'h3';
  const congestion = qs(url, 'congestion_control') || qs(url, 'congestion') || 'bbr';

  return {
    tag: 'proxy',
    protocol: 'tuic',
    settings: { uuid, password, address, port, congestion },
    streamSettings: {
      network: 'quic',
      security: 'tls',
      tlsSettings: { serverName: sni, alpn: alpn.split(',') },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// outbound → URI (обратная конвертация)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Конвертирует outbound-объект (tag:"proxy" из Happ/v2ray/xray конфига) в proxy-URI строку.
 * Принимает как V2rayOutbound так и любой Record<string,unknown> от Prisma JSON-поля.
 * Возвращает null если протокол неизвестен или данных недостаточно.
 */
export function outboundToUri(
  proxy: Record<string, unknown>,
  displayName = '',
): string | null {
  try {
    const protocol = str(proxy['protocol']).toLowerCase();
    switch (protocol) {
      case 'vless':    return outboundVlessToUri(proxy, displayName);
      case 'vmess':    return outboundVmessToUri(proxy, displayName);
      case 'trojan':   return outboundTrojanToUri(proxy, displayName);
      case 'shadowsocks': return outboundSsToUri(proxy, displayName);
      case 'hysteria': {
        // Happ кодирует hysteria2 как protocol:"hysteria" + hysteriaSettings.version:2
        const stream = (proxy['streamSettings'] ?? {}) as Record<string, unknown>;
        const hSets = (stream['hysteriaSettings'] ?? {}) as Record<string, unknown>;
        const settingsVersion = num((proxy['settings'] as Record<string, unknown>)?.['version'], 0);
        const streamVersion = num(hSets['version'], 0);
        if (settingsVersion === 2 || streamVersion === 2) {
          return outboundHysteria2ToUri(proxy, displayName);
        }
        return outboundHysteriaToUri(proxy, displayName);
      }
      case 'hysteria2': return outboundHysteria2ToUri(proxy, displayName);
      case 'tuic':     return outboundTuicToUri(proxy, displayName);
      default:         return null;
    }
  } catch {
    return null;
  }
}

/**
 * Извлекает proxy-outbound из полного Happ/v2ray конфига (с dns/routing/inbounds/outbounds/remarks)
 * или возвращает сам объект если он уже является outbound.
 */
export function extractProxyOutbound(
  obj: Record<string, unknown>,
): Record<string, unknown> | null {
  // Уже outbound-объект: { tag, protocol, settings }
  if (obj['protocol'] && obj['settings']) {
    return obj;
  }
  // Полный конфиг: { outbounds: [...] }
  const outbounds = obj['outbounds'];
  if (Array.isArray(outbounds)) {
    const proxy = outbounds.find(
      (o) => o && typeof o === 'object' && (o as Record<string, unknown>)['tag'] === 'proxy',
    );
    if (proxy) return proxy as Record<string, unknown>;
    // fallback: первый не-служебный
    const first = outbounds.find((o) => {
      if (!o || typeof o !== 'object') return false;
      const p = str((o as Record<string, unknown>)['protocol']).toLowerCase();
      return !['freedom', 'blackhole', 'dns'].includes(p);
    });
    if (first) return first as Record<string, unknown>;
  }
  return null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function appendFragment(uri: string, name: string): string {
  if (!name.trim()) return uri;
  return `${uri}#${encodeURIComponent(name.trim())}`;
}

/** Собирает streamSettings → query params для vless/trojan/ss URI */
function streamToQuery(stream: Record<string, unknown>): URLSearchParams {
  const p = new URLSearchParams();
  const network = str(stream['network']) || 'tcp';
  const security = str(stream['security']) || 'none';
  p.set('type', network);
  if (security && security !== 'none') p.set('security', security);

  // transport
  switch (network) {
    case 'ws': {
      const ws = (stream['wsSettings'] ?? {}) as Record<string, unknown>;
      if (ws['path']) p.set('path', str(ws['path']));
      const headers = (ws['headers'] ?? {}) as Record<string, unknown>;
      if (headers['Host']) p.set('host', str(headers['Host']));
      break;
    }
    case 'grpc': {
      const g = (stream['grpcSettings'] ?? {}) as Record<string, unknown>;
      if (g['serviceName']) p.set('serviceName', str(g['serviceName']));
      break;
    }
    case 'h2':
    case 'http': {
      const h = (stream['httpSettings'] ?? {}) as Record<string, unknown>;
      if (h['path']) p.set('path', str(h['path']));
      const hosts = h['host'];
      if (Array.isArray(hosts) && hosts.length) p.set('host', str(hosts[0]));
      break;
    }
    case 'httpupgrade': {
      const hu = (stream['httpupgradeSettings'] ?? {}) as Record<string, unknown>;
      if (hu['path']) p.set('path', str(hu['path']));
      if (hu['host']) p.set('host', str(hu['host']));
      break;
    }
    case 'xhttp':
    case 'splithttp': {
      const xh = (stream['xhttpSettings'] ?? {}) as Record<string, unknown>;
      if (xh['path']) p.set('path', str(xh['path']));
      if (xh['host']) p.set('host', str(xh['host']));
      break;
    }
    case 'tcp': {
      const tcp = (stream['tcpSettings'] ?? {}) as Record<string, unknown>;
      const header = (tcp['header'] ?? {}) as Record<string, unknown>;
      if (header['type'] && str(header['type']) !== 'none') p.set('headerType', str(header['type']));
      break;
    }
  }

  // security
  switch (security) {
    case 'tls': {
      const tls = (stream['tlsSettings'] ?? {}) as Record<string, unknown>;
      if (tls['serverName']) p.set('sni', str(tls['serverName']));
      if (tls['fingerprint']) p.set('fp', str(tls['fingerprint']));
      const alpn = tls['alpn'];
      if (Array.isArray(alpn) && alpn.length) p.set('alpn', alpn.join(','));
      break;
    }
    case 'reality': {
      const r = (stream['realitySettings'] ?? {}) as Record<string, unknown>;
      if (r['serverName']) p.set('sni', str(r['serverName']));
      if (r['publicKey']) p.set('pbk', str(r['publicKey']));
      if (r['fingerprint']) p.set('fp', str(r['fingerprint']));
      if (r['shortId']) p.set('sid', str(r['shortId']));
      if (r['spiderX']) p.set('spx', str(r['spiderX']));
      break;
    }
  }
  return p;
}

// ─── VLESS ────────────────────────────────────────────────────────────────────

function outboundVlessToUri(proxy: Record<string, unknown>, name: string): string | null {
  const settings = (proxy['settings'] ?? {}) as Record<string, unknown>;
  const vnext = settings['vnext'];
  if (!Array.isArray(vnext) || !vnext.length) return null;
  const first = vnext[0] as Record<string, unknown>;
  const address = str(first['address']);
  const port = num(first['port'], 443);
  const users = first['users'];
  if (!Array.isArray(users) || !users.length) return null;
  const user = users[0] as Record<string, unknown>;
  const uuid = str(user['id']);
  if (!uuid || !address) return null;

  const stream = (proxy['streamSettings'] ?? {}) as Record<string, unknown>;
  const p = streamToQuery(stream);

  const encryption = str(user['encryption']) || 'none';
  p.set('encryption', encryption);
  const flow = str(user['flow']);
  if (flow) p.set('flow', flow);

  const uri = `vless://${uuid}@${address}:${port}?${p.toString()}`;
  return appendFragment(uri, name);
}

// ─── VMESS ────────────────────────────────────────────────────────────────────

function outboundVmessToUri(proxy: Record<string, unknown>, name: string): string | null {
  const settings = (proxy['settings'] ?? {}) as Record<string, unknown>;
  const vnext = settings['vnext'];
  if (!Array.isArray(vnext) || !vnext.length) return null;
  const first = vnext[0] as Record<string, unknown>;
  const address = str(first['address']);
  const port = num(first['port'], 443);
  const users = first['users'];
  if (!Array.isArray(users) || !users.length) return null;
  const user = users[0] as Record<string, unknown>;
  const uuid = str(user['id']);
  if (!uuid || !address) return null;

  const stream = (proxy['streamSettings'] ?? {}) as Record<string, unknown>;
  const network = str(stream['network']) || 'tcp';
  const security = str(stream['security']) || 'none';

  // transport details
  let path = '';
  let host = '';
  switch (network) {
    case 'ws': {
      const ws = (stream['wsSettings'] ?? {}) as Record<string, unknown>;
      path = str(ws['path']);
      const headers = (ws['headers'] ?? {}) as Record<string, unknown>;
      host = str(headers['Host']);
      break;
    }
    case 'grpc': {
      const g = (stream['grpcSettings'] ?? {}) as Record<string, unknown>;
      path = str(g['serviceName']);
      break;
    }
    case 'h2':
    case 'http': {
      const h = (stream['httpSettings'] ?? {}) as Record<string, unknown>;
      path = str(h['path']);
      const hosts = h['host'];
      if (Array.isArray(hosts) && hosts.length) host = str(hosts[0]);
      break;
    }
  }

  let sni = '';
  let fp = '';
  if (security === 'tls') {
    const tls = (stream['tlsSettings'] ?? {}) as Record<string, unknown>;
    sni = str(tls['serverName']);
    fp = str(tls['fingerprint']);
  }

  const config = {
    v: '2',
    ps: name,
    add: address,
    port: String(port),
    id: uuid,
    aid: String(num(user['alterId'], 0)),
    scy: str(user['security']) || 'auto',
    net: network,
    type: 'none',
    host,
    path,
    tls: security === 'tls' ? 'tls' : '',
    sni,
    fp,
    alpn: (() => {
      if (security !== 'tls') return '';
      const tls = (stream['tlsSettings'] ?? {}) as Record<string, unknown>;
      const a = tls['alpn'];
      return Array.isArray(a) ? a.join(',') : '';
    })(),
  };

  const b64 = Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
  return `vmess://${b64}`;
}

// ─── TROJAN ───────────────────────────────────────────────────────────────────

function outboundTrojanToUri(proxy: Record<string, unknown>, name: string): string | null {
  const settings = (proxy['settings'] ?? {}) as Record<string, unknown>;
  const servers = settings['servers'];
  if (!Array.isArray(servers) || !servers.length) return null;
  const first = servers[0] as Record<string, unknown>;
  const address = str(first['address']);
  const port = num(first['port'], 443);
  const password = str(first['password']);
  if (!password || !address) return null;

  const stream = (proxy['streamSettings'] ?? {}) as Record<string, unknown>;
  const p = streamToQuery(stream);

  const uri = `trojan://${encodeURIComponent(password)}@${address}:${port}?${p.toString()}`;
  return appendFragment(uri, name);
}

// ─── SHADOWSOCKS ──────────────────────────────────────────────────────────────

function outboundSsToUri(proxy: Record<string, unknown>, name: string): string | null {
  const settings = (proxy['settings'] ?? {}) as Record<string, unknown>;
  const servers = settings['servers'];
  if (!Array.isArray(servers) || !servers.length) return null;
  const first = servers[0] as Record<string, unknown>;
  const address = str(first['address']);
  const port = num(first['port'], 8388);
  const method = str(first['method']);
  const password = str(first['password']);
  if (!address || !method || !password) return null;

  const userinfo = Buffer.from(`${method}:${password}`, 'utf8').toString('base64');
  const uri = `ss://${userinfo}@${address}:${port}`;
  return appendFragment(uri, name);
}

// ─── HYSTERIA ─────────────────────────────────────────────────────────────────

function outboundHysteriaToUri(proxy: Record<string, unknown>, name: string): string | null {
  const settings = (proxy['settings'] ?? {}) as Record<string, unknown>;
  const address = str(settings['address']);
  const port = num(settings['port'], 443);
  if (!address) return null;

  const stream = (proxy['streamSettings'] ?? {}) as Record<string, unknown>;
  const tls = (stream['tlsSettings'] ?? {}) as Record<string, unknown>;
  const sni = str(tls['serverName']) || address;

  const hSettings = (stream['hysteriaSettings'] ?? {}) as Record<string, unknown>;
  const auth = str(settings['auth'] ?? hSettings['auth']);

  const p = new URLSearchParams();
  p.set('peer', sni);
  if (auth) p.set('auth', auth);
  if (settings['upMbps']) p.set('upmbps', str(settings['upMbps']));
  if (settings['downMbps']) p.set('downmbps', str(settings['downMbps']));

  const uri = `hysteria://${address}:${port}?${p.toString()}`;
  return appendFragment(uri, name);
}

// ─── HYSTERIA2 ────────────────────────────────────────────────────────────────

function outboundHysteria2ToUri(proxy: Record<string, unknown>, name: string): string | null {
  const settings = (proxy['settings'] ?? {}) as Record<string, unknown>;
  const address = str(settings['address']);
  const port = num(settings['port'], 443);
  if (!address) return null;

  const stream = (proxy['streamSettings'] ?? {}) as Record<string, unknown>;
  const tls = (stream['tlsSettings'] ?? {}) as Record<string, unknown>;
  const sni = str(tls['serverName']) || address;

  const hSettings = (stream['hysteriaSettings'] ?? {}) as Record<string, unknown>;
  // Happ хранит auth в hysteriaSettings.auth или settings.auth
  const auth = str(hSettings['auth'] ?? settings['auth']);

  const p = new URLSearchParams();
  p.set('sni', sni);
  if (auth) p.set('auth', auth);
  const obfs = str(settings['obfs']);
  if (obfs) p.set('obfs', obfs);
  const obfsPwd = str(settings['obfsPassword']);
  if (obfsPwd) p.set('obfs-password', obfsPwd);

  const userPart = auth ? `${encodeURIComponent(auth)}@` : '';
  const uri = `hysteria2://${userPart}${address}:${port}?${p.toString()}`;
  return appendFragment(uri, name);
}

// ─── TUIC ─────────────────────────────────────────────────────────────────────

function outboundTuicToUri(proxy: Record<string, unknown>, name: string): string | null {
  const settings = (proxy['settings'] ?? {}) as Record<string, unknown>;
  const uuid = str(settings['uuid']);
  const password = str(settings['password']);
  const address = str(settings['address']);
  const port = num(settings['port'], 443);
  if (!uuid || !address) return null;

  const stream = (proxy['streamSettings'] ?? {}) as Record<string, unknown>;
  const tls = (stream['tlsSettings'] ?? {}) as Record<string, unknown>;
  const sni = str(tls['serverName']) || address;
  const alpn = Array.isArray(tls['alpn']) ? (tls['alpn'] as string[]).join(',') : 'h3';
  const congestion = str(settings['congestion']) || 'bbr';

  const p = new URLSearchParams();
  p.set('sni', sni);
  p.set('alpn', alpn);
  p.set('congestion_control', congestion);

  const uri = `tuic://${encodeURIComponent(uuid)}:${encodeURIComponent(password)}@${address}:${port}?${p.toString()}`;
  return appendFragment(uri, name);
}
