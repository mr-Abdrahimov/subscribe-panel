/**
 * Стабильный ключ для сопоставления строк подписки с коннектом в БД.
 * Учитывает «тот же» сервер/параметры при мелких отличиях в строке (пробелы, порядок query, регистр хоста).
 * Фрагмент #… (отображаемое имя в Happ) в ключ не входит — совпадение по «телу» ссылки.
 */
export function normalizedConnectIdentity(raw: string): string {
  const trimmed = raw.trim();
  const hashIdx = trimmed.indexOf('#');
  const base = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;

  try {
    const u = new URL(base);
    const protocol = u.protocol.replace(/:$/, '').toLowerCase();
    const hostname = u.hostname.toLowerCase();
    const port = u.port;
    let pathname = u.pathname || '';
    if (pathname === '/' || pathname === '') {
      pathname = '';
    } else {
      pathname = pathname.replace(/\/+$/, '');
    }

    const userDecoded =
      u.username !== '' ? safeDecodeURIComponent(u.username) : '';
    const passDecoded =
      u.password !== '' ? safeDecodeURIComponent(u.password) : '';
    const userinfo =
      userDecoded !== ''
        ? `${normalizeUserinfoToken(userDecoded)}${
            passDecoded !== '' ? ':' + passDecoded : ''
          }@`
        : '';

    const params = u.searchParams;
    const keys = [...new Set(params.keys())].sort((a, b) =>
      a.localeCompare(b),
    );
    const pairs: string[] = [];
    for (const k of keys) {
      const vals = params.getAll(k).sort((a, b) => a.localeCompare(b));
      for (const v of vals) {
        pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
      }
    }
    const search = pairs.length ? `?${pairs.join('&')}` : '';

    const hostPart = port ? `${hostname}:${port}` : hostname;
    return `${protocol}://${userinfo}${hostPart}${pathname}${search}`;
  } catch {
    return base.replace(/\s+/g, '').toLowerCase();
  }
}

function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** UUID в userinfo приводим к нижнему регистру (в подписках часто плавает регистр). */
function normalizeUserinfoToken(s: string): string {
  const t = s.trim();
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      t,
    )
  ) {
    return t.toLowerCase();
  }
  return t;
}
