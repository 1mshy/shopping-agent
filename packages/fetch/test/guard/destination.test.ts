// The guard's decision on one URL and the resolver's answer for its host (S§5.1 "Guard first"),
// beyond the corpus: schemes, URLs unacceptable as written, IP-literal spellings, DNS answers.
import type { Rung } from '@agentic-dasher/shared';
import { describe, expect, test } from 'vitest';
import { checkDestination, type DnsAnswer, type GuardDecision } from '../../src/guard/index.ts';

const at = (...addresses: string[]): DnsAnswer => ({ kind: 'addresses', addresses });
const PUBLIC = at('93.184.215.14');

function refused(reason: string, rung: Rung = 'http'): GuardDecision {
  return { pass: false, outcome: { kind: 'refused_by_policy', rung, reason } } as GuardDecision;
}

function check(url: string, answer: DnsAnswer | null = null, rung: Rung = 'http'): GuardDecision {
  return checkDestination({ url, rung, answer });
}

describe('http and https only', () => {
  test.each([
    'ftp://store.example/',
    'ws://store.example/',
    'wss://store.example/',
    'view-source:http://store.example/',
    'blob:https://store.example/0b8d',
    'about:blank',
    'mailto:shop@store.example',
    'tel:+15550100',
    'httpx://store.example/',
    'https+unix://store.example/',
    'file:///etc/passwd',
    ' http://store.example/',
    '\thttp://store.example/',
    'http//store.example/',
    '//store.example/p/1',
    '?q=1',
    '#top',
  ])('%j is refused as scheme, before any lookup', (url) => {
    expect(check(url, PUBLIC)).toEqual(refused('scheme'));
  });
});

describe('a URL not acceptable as written is refused as url_form', () => {
  test.each([
    'http:store.example/p/1',
    'http:/store.example/p/1',
    'https:\\\\store.example/p/1',
    'http:\\/store.example/',
    'https:///p/1',
    'https:////store.example/p/1',
    'http://',
    'http://:80/',
    'http://?q=1',
    'http://#top',
    'http://@store.example/',
    'http://user@store.example/',
    'http://user:@store.example/',
    'http://:pass@store.example/',
    'http://user:pass@store.example/',
    'http://store.example@93.184.215.14/',
    'http://store.example%40evil.example/',
    'http://store.example\\@evil.example/',
    'http://store.example\\evil/',
    'http://store.example/a\\b',
    'http://store .example/',
    'http://store.example /',
    'http://store.example/a b',
    'http://store.example/\t',
    'http://store.ex\tample/',
    'http://127.0.0.\n1/',
    'http://store.example/\r\n',
    'http://store.example/\u0000',
    'http://store.example/\u007f',
    'http://[fe80::1%25en0]/',
    'http://[fe80::1%en0]/',
    'http://[::1/',
    'http://1.2.3.4.5/',
    'http://1.2.3.256/',
    'http://4294967296/',
    'http://08.0.0.1/',
    'http://store.0x7f/',
    'http://store.example:99999/',
    'http://store.example:port/',
  ])('%j is refused as url_form', (url) => {
    expect(check(url, PUBLIC)).toEqual(refused('url_form'));
  });

  test('user-info is refused whatever the host and the rung', () => {
    expect(check('https://a@b@store.example/', PUBLIC, 'browser')).toEqual(
      refused('url_form', 'browser'),
    );
  });
});

describe('an IP literal in any spelling is judged by the address it denotes', () => {
  test.each([
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0X7F000001/',
    'http://0x7f.1/',
    'http://0x7f.0x0.0x0.0x1/',
    'http://0177.0.0.1/',
    'http://00000000177.0.0.1/',
    'http://0177.1/',
    'http://127.1/',
    'http://127.0.1/',
    'http://127.0.0.1./',
    'http://%31%32%37.0.0.1/',
    'http://%31%32%37%2e%30%2e%30%2e%31/',
    'http://１２７.０.０.１/',
    'http://127。0。0。1/',
    'http://0/',
    'http://0.0.0.0/',
    'http://0x0a000001/',
    'http://167772161/',
    'http://3232235777/',
    'http://0xa9fea9fe/',
    'http://2852039166/',
    'http://169.254.169.254./',
    'http://[::1]/',
    'http://[0:0:0:0:0:0:0:1]/',
    'http://[::]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://[0:0:0:0:0:ffff:10.0.0.1]/',
    'http://[::127.0.0.1]/',
    'http://[64:ff9b::7f00:1]/',
    'http://[64:ff9b::169.254.169.254]/',
    'http://[fe80::1]/',
    'http://[FD00:EC2::254]/',
    'http://[2001:db8::1]/',
    'http://[2002:7f00:1::1]/',
    'http://[ff02::1]/',
  ])('%s is refused as private_address without a lookup', (url) => {
    // The answer must not be consulted for a literal: it says public here.
    expect(check(url, PUBLIC)).toEqual(refused('private_address'));
    expect(check(url, null)).toEqual(refused('private_address'));
  });

  test.each([
    ['http://16843009/', '1.1.1.1'],
    ['http://0x01010101/', '1.1.1.1'],
    ['http://1.1.257/', '1.1.1.1'],
    ['http://[::ffff:1.1.1.1]/', '1.1.1.1'],
    ['http://[2606:4700:4700:0:0:0:0:1111]/', '2606:4700:4700::1111'],
    ['https://[2606:4700:4700::1111]:8443/p', '2606:4700:4700::1111'],
    ['http://[64:ff9b::1.1.1.1]/', '64:ff9b::101:101'],
  ])('%s passes and connects to %s only', (url, address) => {
    const privateAnswer = at('10.0.0.1');
    expect(check(url, privateAnswer)).toEqual({ pass: true, connectTo: [address] });
  });
});

describe('a host name is judged by every address the resolver answered', () => {
  test('no answer supplied for a name: refused, never passed', () => {
    expect(check('https://store.example/', null)).toEqual(refused('private_address'));
  });

  test('NXDOMAIN is a network error, not a refusal', () => {
    expect(check('https://store.example/', { kind: 'nxdomain' }, 'api')).toEqual({
      pass: false,
      outcome: { kind: 'network_error', rung: 'api', code: 'ENOTFOUND' },
    });
  });

  test('an empty answer is a network error, like NXDOMAIN', () => {
    expect(check('https://store.example/', at())).toEqual({
      pass: false,
      outcome: { kind: 'network_error', rung: 'http', code: 'ENOTFOUND' },
    });
  });

  test.each([
    [['93.184.215.14', '10.0.0.30']],
    [['10.0.0.30', '93.184.215.14']],
    [['93.184.215.14', '2606:4700:4700::1111', '::1']],
    [['93.184.215.14', '::ffff:127.0.0.1']],
    [['93.184.215.14', '64:ff9b::a9fe:a9fe']],
    [['93.184.215.14', 'fe80::1%en0']],
    [['93.184.215.14', '127.1']],
    [['93.184.215.14', 'localhost']],
    [['93.184.215.14', '']],
    [['0.0.0.0']],
  ])('a mixed or special answer %j is refused outright', (addresses) => {
    expect(check('https://store.example/', at(...addresses))).toEqual(refused('private_address'));
  });

  test('a malformed answer (not a list of strings) is refused', () => {
    const bad = { kind: 'addresses', addresses: [1, null] } as unknown as DnsAnswer;
    expect(check('https://store.example/', bad)).toEqual(refused('private_address'));
    const notList = { kind: 'addresses', addresses: '93.184.215.14' } as unknown as DnsAnswer;
    expect(check('https://store.example/', notList)).toEqual(refused('private_address'));
  });

  test('every answer is kept, de-duplicated, IPv4 first, in canonical form', () => {
    const answer = at(
      '2606:4700:4700:0:0:0:0:1111',
      '93.184.215.14',
      '1.1.1.1',
      '93.184.215.14',
      '::ffff:1.1.1.1',
      '2606:4700:4700::1111',
    );
    expect(check('https://store.example/', answer)).toEqual({
      pass: true,
      connectTo: ['93.184.215.14', '1.1.1.1', '2606:4700:4700::1111'],
    });
  });

  test.each([
    'http://localhost/',
    'http://LOCALHOST:8000/',
    'http://localhost./',
    'http://api.localhost/',
    'http://a.b.localhost./',
  ])('%s is refused whatever the resolver says (RFC 6761)', (url) => {
    expect(check(url, PUBLIC)).toEqual(refused('private_address'));
  });

  test.each([
    'https://notlocalhost.example/',
    'https://localhost.example/',
    'https://store.example./',
    'https://xn--bcher-kva.example/',
    'https://bücher.example/',
  ])('%s passes with a public answer', (url) => {
    expect(check(url, PUBLIC)).toEqual({ pass: true, connectTo: ['93.184.215.14'] });
  });

  test('a refusal names the rung that was about to fetch', () => {
    expect(check('https://store.example/', at('10.0.0.1'), 'browser')).toEqual(
      refused('private_address', 'browser'),
    );
  });
});
