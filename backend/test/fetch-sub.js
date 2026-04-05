// fetch-sub.js
const https = require('https');

const SUB_URL = 'https://sub.cocooloco.ru/Fm3n6ctxkVuxTF_A';

function fetchSub(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Happ/4.7.0/ios/2604011943588',  // некоторые панели требуют User-Agent
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  try {
    const raw = await fetchSub(SUB_URL);
    console.log(raw);

    // Попытка распарсить как JSON
    const json = JSON.parse(raw);
    console.log('Тип ответа: JSON');
    console.log('Данные:', JSON.stringify(json, null, 2));

    // Если массив узлов
    if (Array.isArray(json)) {
      console.log(`\nВсего узлов: ${json.length}`);
    } else if (json.proxies) {
      // Формат Clash/Mihomo
      console.log(`\nВсего proxies: ${json.proxies.length}`);
      json.proxies.forEach((p, i) => {
        console.log(`[${i + 1}] ${p.name} — ${p.type} — ${p.server}:${p.port}`);
      });
    }

  } catch (err) {
    console.error('Ошибка парсинга:', err.message);
  }
}

main();