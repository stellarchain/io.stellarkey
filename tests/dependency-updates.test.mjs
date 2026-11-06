import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('@stellar/stellar-sdk'));
const axiosRequire = createRequire(sdkRequire.resolve('axios'));
const redirects = axiosRequire('follow-redirects');
const trezorRequire = createRequire(require.resolve('@trezor/blockchain-link-types'));
const agentRequire = createRequire(trezorRequire.resolve('socks-proxy-agent'));
const socksRequire = createRequire(agentRequire.resolve('socks'));
const { Address4, Address6 } = socksRequire('ip-address');

test('the installed Stellar HTTP redirect dependency strips cross-realm custom credentials', async t => {
  let received;
  const target = createServer((request, response) => {
    received = request.headers;
    response.end('synthetic response');
  });
  const origin = createServer((_request, response) => {
    response.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}/` });
    response.end();
  });
  for (const server of [target, origin]) {
    t.after(() => new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    }));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  }
  const sensitiveHeaders = runInNewContext("['X-Fixture-Credential']");
  assert.equal(Array.isArray(sensitiveHeaders), true);
  assert.equal(sensitiveHeaders instanceof Array, false);
  await new Promise((resolve, reject) => {
    const request = redirects.http.get({
      hostname: '127.0.0.1', port: origin.address().port, path: '/',
      headers: { 'X-Fixture-Credential': 'synthetic-only', 'X-Fixture-Public': 'retained' },
      sensitiveHeaders,
      timeout: 5_000,
    }, response => {
      response.resume();
      response.once('end', resolve);
      response.once('error', reject);
    });
    request.once('error', reject);
    request.once('timeout', () => request.destroy(new Error('Synthetic redirect timed out.')));
  });
  assert.equal(received?.['x-fixture-credential'], undefined);
  assert.equal(received?.['x-fixture-public'], 'retained');
});

test('the installed Trezor SOCKS dependency classifies the entire IPv6 link-local range', () => {
  for (const address of ['fe80::1', 'fe90::1', 'febf::1']) {
    assert.equal(new Address6(address).isLinkLocal(), true);
  }
  assert.equal(new Address6('fec0::1').isLinkLocal(), false);
});

test('the installed Trezor SOCKS dependency keeps IPv4 and IPv6 subnet membership separate', () => {
  assert.equal(new Address4('0.0.0.1').isInSubnet(new Address6('::/64')), false);
  assert.equal(new Address6('::1').isInSubnet(new Address4('0.0.0.0/8')), false);
  assert.equal(new Address4('192.0.2.1').isInSubnet(new Address4('192.0.2.0/24')), true);
  assert.equal(new Address6('2001:db8::1').isInSubnet(new Address6('2001:db8::/32')), true);
});
