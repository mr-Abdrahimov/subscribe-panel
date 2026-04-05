import {
  normalizedConnectIdentity,
  subscriptionIncomingDedupeKey,
  vlessCoreIdentityForMatching,
  vlessStableMatchIdentity,
} from './connect-identity.util';

describe('normalizedConnectIdentity', () => {
  it('сводит порядок query и регистр type', () => {
    const a =
      'vless://f2c0e35b-afd5-4848-fa13-e407a35f528a@91.108.4.136:443?encryption=none&security=tls&type=ws&path=%2Fws';
    const b =
      'vless://f2c0e35b-afd5-4848-fa13-e407a35f528a@91.108.4.136:443?type=WS&path=/ws&security=tls&encryption=none';
    expect(normalizedConnectIdentity(a)).toBe(normalizedConnectIdentity(b));
  });

  it('сводит регистр UUID в userinfo', () => {
    const a = 'vless://F2C0E35B-AFD5-4848-FA13-E407A35F528A@h.com:1?type=tcp';
    const b = 'vless://f2c0e35b-afd5-4848-fa13-e407a35f528a@h.com:1?type=tcp';
    expect(normalizedConnectIdentity(a)).toBe(normalizedConnectIdentity(b));
  });

  it('игнорирует фрагмент #', () => {
    const a = 'vless://u@h.com:443?type=tcp#Server1';
    const b = 'vless://u@h.com:443?type=tcp#Server2';
    expect(normalizedConnectIdentity(a)).toBe(normalizedConnectIdentity(b));
  });

  it('объединяет ключи query без учёта регистра имён', () => {
    const a = 'vless://u@h:1?Type=tcp&flow=xtls';
    const b = 'vless://u@h:1?flow=xtls&type=tcp';
    expect(normalizedConnectIdentity(a)).toBe(normalizedConnectIdentity(b));
  });

  it('сводит неявный порт 443 и явный :443 для vless', () => {
    const a =
      'vless://f2c0e35b-afd5-4848-fa13-e407a35f528a@example.com?type=tcp&encryption=none';
    const b =
      'vless://f2c0e35b-afd5-4848-fa13-e407a35f528a@example.com:443?encryption=none&type=tcp';
    expect(normalizedConnectIdentity(a)).toBe(normalizedConnectIdentity(b));
  });

  it('убирает пустые параметры из ключа', () => {
    const a =
      'vless://f2c0e35b-afd5-4848-fa13-e407a35f528a@x.com:1?type=tcp&remark=';
    const b = 'vless://f2c0e35b-afd5-4848-fa13-e407a35f528a@x.com:1?type=tcp';
    expect(normalizedConnectIdentity(a)).toBe(normalizedConnectIdentity(b));
  });

  it('сводит двойное кодирование в query', () => {
    const a =
      'vless://f2c0e35b-afd5-4848-fa13-e407a35f528a@x.com:1?path=%252Fws&type=ws';
    const b =
      'vless://f2c0e35b-afd5-4848-fa13-e407a35f528a@x.com:1?type=ws&path=%2Fws';
    expect(normalizedConnectIdentity(a)).toBe(normalizedConnectIdentity(b));
  });

  it('сводит незакодированный # в значении remark с вариантом %23', () => {
    const withRawHash =
      'vless://f2c0e35b-afd5-4848-fa13-e407a35f528a@91.108.4.136:443?encryption=none&security=tls&type=ws&path=%2Fws&remark=List #5&host=cdn.example.com';
    const withEncodedHash =
      'vless://f2c0e35b-afd5-4848-fa13-e407a35f528a@91.108.4.136:443?encryption=none&security=tls&type=ws&path=%2Fws&remark=List%20%235&host=cdn.example.com';
    expect(normalizedConnectIdentity(withRawHash)).toBe(
      normalizedConnectIdentity(withEncodedHash),
    );
  });

  it('сводит кириллицу в remark в формах NFC и NFD', () => {
    const nfc = 'тест';
    const nfd = nfc.normalize('NFD');
    const a = `vless://u@h.com:1?type=tcp&remark=${encodeURIComponent(nfc)}`;
    const b = `vless://u@h.com:1?type=tcp&remark=${encodeURIComponent(nfd)}`;
    expect(normalizedConnectIdentity(a)).toBe(normalizedConnectIdentity(b));
  });

  it('для vless сводит encryption=none и отсутствие encryption', () => {
    const withEnc =
      'vless://f2c0e35b-afd5-4848-fa13-e407a35f528a@x.com:443?encryption=none&flow=xtls-rprx-vision&type=tcp&security=reality&fp=qq&sni=h.com&pbk=AbCd_EfGhIjKlMnOpQrStUvWxYz0123456789';
    const withoutEnc = withEnc.replace('encryption=none&', '');
    expect(normalizedConnectIdentity(withEnc)).toBe(
      normalizedConnectIdentity(withoutEnc),
    );
  });

  it('для vless сводит headerType=none при type=tcp с вариантом без headerType', () => {
    const withHt =
      'vless://f2c0e35b-afd5-4848-fa13-e407a35f528a@x.com:443?flow=xtls-rprx-vision&type=tcp&headerType=none&security=reality&fp=qq&sni=h.com&pbk=AbCd_EfGhIjKlMnOpQrStUvWxYz0123456789';
    const withoutHt = withHt.replace('&headerType=none', '');
    expect(normalizedConnectIdentity(withHt)).toBe(
      normalizedConnectIdentity(withoutHt),
    );
  });

  it('для vless сводит serverName и sni при одинаковом значении', () => {
    const a =
      'vless://f2c0e35b-afd5-4848-fa13-e407a35f528a@x.com:443?type=tcp&security=reality&sni=eh.vk.com&fp=qq&pbk=AbCd_EfGhIjKlMnOpQrStUvWxYz0123456789';
    const b =
      'vless://f2c0e35b-afd5-4848-fa13-e407a35f528a@x.com:443?type=tcp&security=reality&serverName=eh.vk.com&fp=qq&pbk=AbCd_EfGhIjKlMnOpQrStUvWxYz0123456789';
    expect(normalizedConnectIdentity(a)).toBe(normalizedConnectIdentity(b));
  });
});

describe('vlessCoreIdentityForMatching', () => {
  it('сводит варианты с лишними fp, encryption, headerType, utls', () => {
    const base =
      'vless://d3958b70-9432-4c84-9ced-8f72abbc8a00@maja.example.com:443?flow=xtls-rprx-vision&type=tcp&security=reality&fp=qq&sni=eh.vk.com&pbk=ZKMzvBjUt7eJV_V4SVFelb470SW8Qo3OAdZYcDT2XXo&sid=fc1945b1bf';
    const noisy = `${base}&encryption=none&headerType=none&utls=chrome&remark=x`;
    expect(vlessCoreIdentityForMatching(base)).toBe(
      vlessCoreIdentityForMatching(noisy),
    );
  });

  it('не учитывает sid (может меняться между выдачами подписки)', () => {
    const a =
      'vless://d3958b70-9432-4c84-9ced-8f72abbc8a00@maja.example.com:443?type=tcp&security=reality&flow=x&sni=h.com&pbk=AbCd_EfGhIjKlMnOpQrStUvWxYz0123456789&sid=aaaaaaaaaa';
    const b = a.replace('sid=aaaaaaaaaa', 'sid=bbbbbbbbbb');
    expect(vlessCoreIdentityForMatching(a)).toBe(
      vlessCoreIdentityForMatching(b),
    );
    expect(normalizedConnectIdentity(a)).toBe(normalizedConnectIdentity(b));
  });

  it('для не-vless возвращает null', () => {
    expect(vlessCoreIdentityForMatching('trojan://p@h.com:443')).toBeNull();
  });
});

describe('vlessStableMatchIdentity', () => {
  it('сводит варианты, отличающиеся только UUID в userinfo', () => {
    const a =
      'vless://98da9046-cec1-4a87-ac9c-76a787596bdb@ru5.mambo-jambo.ru:443?encryption=none&type=xhttp&path=%2F&host=enterprisekitten.com&mode=stream-one&security=none';
    const b = a.replace(
      '98da9046-cec1-4a87-ac9c-76a787596bdb',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );
    expect(normalizedConnectIdentity(a)).not.toBe(normalizedConnectIdentity(b));
    expect(vlessStableMatchIdentity(a)).toBe(vlessStableMatchIdentity(b));
  });

  it('сводит варианты, отличающиеся только sni', () => {
    const a =
      'vless://d3958b70-9432-4c84-9ced-8f72abbc8a00@maja.example.com:443?type=tcp&security=reality&flow=x&sni=old.example.com&pbk=AbCd_EfGhIjKlMnOpQrStUvWxYz0123456789';
    const b = a.replace('sni=old.example.com', 'sni=new.example.com');
    expect(normalizedConnectIdentity(a)).not.toBe(normalizedConnectIdentity(b));
    expect(vlessStableMatchIdentity(a)).toBe(vlessStableMatchIdentity(b));
  });

  it('для не-vless возвращает null', () => {
    expect(vlessStableMatchIdentity('ss://YmFzZTY0@h:1')).toBeNull();
  });
});

describe('subscriptionIncomingDedupeKey', () => {
  it('для vless с разным UUID даёт один ключ', () => {
    const a =
      'vless://98da9046-cec1-4a87-ac9c-76a787596bdb@ru5.mambo-jambo.ru:443?type=xhttp&path=%2F&host=enterprisekitten.com&mode=stream-one&security=none';
    const b = a.replace(
      '98da9046-cec1-4a87-ac9c-76a787596bdb',
      '11111111-2222-3333-4444-555555555555',
    );
    expect(subscriptionIncomingDedupeKey(a)).toBe(subscriptionIncomingDedupeKey(b));
  });

  it('для vless с разным sni даёт один ключ', () => {
    const a =
      'vless://d3958b70-9432-4c84-9ced-8f72abbc8a00@maja.example.com:443?type=tcp&security=reality&sni=a.com&pbk=AbCd_EfGhIjKlMnOpQrStUvWxYz0123456789';
    const b = a.replace('sni=a.com', 'sni=b.com');
    expect(subscriptionIncomingDedupeKey(a)).toBe(subscriptionIncomingDedupeKey(b));
  });

  it('для не-vless совпадает с normalizedConnectIdentity', () => {
    const u = 'trojan://p@h.com:443/path?peer=sni#x';
    expect(subscriptionIncomingDedupeKey(u)).toBe(normalizedConnectIdentity(u));
  });
});
