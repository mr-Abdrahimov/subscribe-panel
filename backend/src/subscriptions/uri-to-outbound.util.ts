/**
 * Конвертация proxy-URI (vless://, vmess://, trojan://, ss://, hysteria://, hysteria2://, tuic://)
 * в outbound-объект формата xray/v2ray (tag: "proxy").
 *
 * Цель — сохранить `rawJson` для Base64-коннектов, чтобы они могли отдаваться в JSON-ленте.
 * Для неизвестных протоколов возвращается null.
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
