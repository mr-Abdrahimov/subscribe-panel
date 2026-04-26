const url = 'https://challenge.sendly.one/crypt/PP92VxtFZTkZRjZIvy/HXMyJoOsi1ykq9aU?key=key09';

function looksLikeBase64(str) {
  const s = str.trim();
  return s.length > 0 && s.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(s);
}

async function main() {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'X-HWID': '8aa65da1baf4f22a',
      'Connection': 'keep-alive',
      'X-Device-OS': 'macOS',
      'X-Device-Locale': 'ru',
      'Accept-Encoding': 'gzip, deflate, br',
      'If-None-Match': 'W/"2927-1xES5jfyaL7GcApf4JC529f24Gg"',
      'Accept-Language': 'ru',
      'User-Agent': 'Happ/4.8.2/macos catalyst/2604241624661',
      'X-Ver-OS': '26.4.1',
      'X-App-Version': '4.8.2',
      'X-Device-model': 'MacBook',
    },
    signal: AbortSignal.timeout(15000)
  });

  console.log('status:', res.status);
  console.log('headers:', res.headers);
  console.log('content-type:', res.headers.get('content-type'));

  const raw = (await res.text()).trim();

  try {
    const json = JSON.parse(raw);
    console.log(JSON.stringify(json, null, 2));
    return;
  } catch {}


  console.log(raw);
}

main().catch(console.error);