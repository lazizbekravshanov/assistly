import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { readRequestBody } from '../src/http/request_body.js';

test('readRequestBody reads full payload within max bytes', async () => {
  const req = new PassThrough();
  const bodyPromise = readRequestBody(req, { maxBytes: 32 });
  req.end('{"ok":true}');

  const body = await bodyPromise;
  assert.equal(body, '{"ok":true}');
});

test('readRequestBody rejects when payload exceeds max bytes', async () => {
  const req = new PassThrough();
  const bodyPromise = readRequestBody(req, { maxBytes: 5 });
  req.write('abcdef');
  req.end();

  await assert.rejects(bodyPromise, (err) => err?.code === 'payload_too_large');
});
