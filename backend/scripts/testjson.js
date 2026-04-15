const url = 'https://sub.avtlk.ru/sub/fz9f6s9TBopou2eJS86N0xMRX';

function looksLikeBase64(str) {
  const s = str.trim();
  return s.length > 0 && s.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(s);
}

async function main() {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'User-Agent': 'Happ/4.7.0/ios/2604011943588',
      'HWID': '8aa65da1baf4f23a',
      'X-HWID': '8aa65da1baf4f23a',
      'Connection': 'keep-alive'
    },
    signal: AbortSignal.timeout(15000)
  });

  console.log('status:', res.status);
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