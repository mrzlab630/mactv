const test = require('node:test');
const assert = require('node:assert/strict');
const { getIinaMediaUrl, getUrlProtocol, isExternalPlayerUrl } = require('../external-protocols');

test('detects Lampa external player protocols', () => {
  assert.equal(isExternalPlayerUrl('iina://weblink?url=http%3A%2F%2F127.0.0.1%3A8090%2Fstream%2Ffile.mkv'), true);
  assert.equal(isExternalPlayerUrl('mpv://http://127.0.0.1:8090/stream/file.mkv'), true);
  assert.equal(isExternalPlayerUrl('infuse://x-callback-url/play?url=http%3A%2F%2F127.0.0.1'), true);
  assert.equal(isExternalPlayerUrl('nplayer-http://127.0.0.1:8090/stream/file.mkv'), true);
});

test('does not treat normal navigation as external player launch', () => {
  assert.equal(isExternalPlayerUrl('http://lampa.mx/'), false);
  assert.equal(isExternalPlayerUrl('https://www.youtube.com/'), false);
  assert.equal(isExternalPlayerUrl('about:blank'), false);
  assert.equal(isExternalPlayerUrl('file:///tmp/movie.mkv'), false);
});

test('normalizes protocol names', () => {
  assert.equal(getUrlProtocol('IINA://weblink?url=x'), 'iina:');
  assert.equal(getUrlProtocol('nplayer-HTTPS://example.test/movie.mkv'), 'nplayer-https:');
  assert.equal(getUrlProtocol('not a url'), '');
});

test('extracts IINA media url', () => {
  const mediaUrl = 'http://127.0.0.1:8090/stream/file.mkv?link=abc&index=1&play';

  assert.equal(getIinaMediaUrl(`iina://weblink?url=${encodeURIComponent(mediaUrl)}`), mediaUrl);
  assert.equal(getIinaMediaUrl(`IINA://weblink?url=${encodeURIComponent(mediaUrl)}`), mediaUrl);
  assert.equal(getIinaMediaUrl('mpv://http://127.0.0.1:8090/stream/file.mkv'), '');
  assert.equal(getIinaMediaUrl('not a url'), '');
});
