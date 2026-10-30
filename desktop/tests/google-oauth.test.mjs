import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGoogleDesktopClient } from '../src/lib/googleOAuth.ts';

test('accepts the desktop client configuration and rejects web or malformed credentials', () => {
  const client = { client_id:'example.apps.googleusercontent.com', client_secret:'test-only' };
  assert.deepEqual(parseGoogleDesktopClient(JSON.stringify({ installed:client })), { clientId:client.client_id, clientSecret:client.client_secret });
  assert.throws(() => parseGoogleDesktopClient(JSON.stringify({ web:client })));
  assert.throws(() => parseGoogleDesktopClient(JSON.stringify({ installed:{ ...client, client_id:'bad' } })));
  assert.throws(() => parseGoogleDesktopClient('{'));
});
