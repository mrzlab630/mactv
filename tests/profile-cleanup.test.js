const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  cleanObsoleteProfileData,
  getProfileCleanupTargets,
  isRemovableCommonCacheDirName,
  isRemovableCacheDirName,
} = require('../profile-cleanup');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tv-electron-profile-'));
}

function makeDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'marker'), 'keep-or-remove', 'utf8');
}

function exists(root, ...segments) {
  return fs.existsSync(path.join(root, ...segments));
}

test('recognizes only cache directories that are safe to remove', () => {
  assert.equal(isRemovableCacheDirName('Cache'), true);
  assert.equal(isRemovableCacheDirName('Code Cache'), true);
  assert.equal(isRemovableCacheDirName('GPUCache'), true);
  assert.equal(isRemovableCacheDirName('DawnCache'), true);
  assert.equal(isRemovableCacheDirName('DawnGraphiteCache'), true);
  assert.equal(isRemovableCacheDirName('DawnWebGPUCache'), true);
  assert.equal(isRemovableCacheDirName('ShaderCache'), true);
  assert.equal(isRemovableCacheDirName('VideoDecodeStats'), true);

  assert.equal(isRemovableCacheDirName('Cookies'), false);
  assert.equal(isRemovableCacheDirName('Local Storage'), false);
  assert.equal(isRemovableCacheDirName('IndexedDB'), false);
  assert.equal(isRemovableCacheDirName('Preferences'), false);
  assert.equal(isRemovableCacheDirName('Session Storage'), false);

  assert.equal(isRemovableCommonCacheDirName('Cache'), true);
  assert.equal(isRemovableCommonCacheDirName('Code Cache'), true);
  assert.equal(isRemovableCommonCacheDirName('GPUCache'), true);
  assert.equal(isRemovableCommonCacheDirName('DawnWebGPUCache'), true);
  assert.equal(isRemovableCommonCacheDirName('ShaderCache'), false);
  assert.equal(isRemovableCommonCacheDirName('VideoDecodeStats'), false);
});

test('builds cleanup targets for obsolete okko partition and allowed caches only', () => {
  const root = makeTempDir();
  makeDir(path.join(root, 'Cache'));
  makeDir(path.join(root, 'Local Storage'));
  makeDir(path.join(root, 'Partitions', 'lampa', 'Code Cache'));
  makeDir(path.join(root, 'Partitions', 'lampa', 'IndexedDB'));
  makeDir(path.join(root, 'Partitions', 'youtube', 'DawnWebGPUCache'));
  makeDir(path.join(root, 'Partitions', 'okko', 'Cookies'));

  const relativeTargets = getProfileCleanupTargets(root)
    .map((target) => path.relative(root, target))
    .sort();

  assert.deepEqual(relativeTargets, [
    'Cache',
    path.join('Partitions', 'lampa', 'Code Cache'),
    path.join('Partitions', 'okko'),
    path.join('Partitions', 'youtube', 'DawnWebGPUCache'),
  ]);
});

test('cleans obsolete profile data without touching persisted browser storage', () => {
  const root = makeTempDir();
  const removableRootDirs = [
    'Cache',
    'Code Cache',
    'GPUCache',
    'DawnCache',
    'DawnGraphiteCache',
  ];
  const protectedRootDirs = [
    'Cookies',
    'Local Storage',
    'IndexedDB',
    'Preferences',
    'Session Storage',
    'ShaderCache',
    'VideoDecodeStats',
  ];

  for (const dir of removableRootDirs) makeDir(path.join(root, dir));
  for (const dir of protectedRootDirs) makeDir(path.join(root, dir));

  makeDir(path.join(root, 'Partitions', 'lampa', 'Cache'));
  makeDir(path.join(root, 'Partitions', 'lampa', 'Code Cache'));
  makeDir(path.join(root, 'Partitions', 'lampa', 'GPUCache'));
  makeDir(path.join(root, 'Partitions', 'lampa', 'DawnWebGPUCache'));
  makeDir(path.join(root, 'Partitions', 'lampa', 'ShaderCache'));
  makeDir(path.join(root, 'Partitions', 'lampa', 'VideoDecodeStats'));
  makeDir(path.join(root, 'Partitions', 'lampa', 'Cookies'));
  makeDir(path.join(root, 'Partitions', 'lampa', 'Local Storage'));
  makeDir(path.join(root, 'Partitions', 'lampa', 'IndexedDB'));
  makeDir(path.join(root, 'Partitions', 'lampa', 'Preferences'));
  makeDir(path.join(root, 'Partitions', 'lampa', 'Session Storage'));
  makeDir(path.join(root, 'Partitions', 'okko', 'Cookies'));
  makeDir(path.join(root, 'Partitions', 'okko', 'Local Storage'));

  const results = cleanObsoleteProfileData(root);
  assert.equal(results.some((result) => result.removed), true);

  for (const dir of removableRootDirs) {
    assert.equal(exists(root, dir), false, `${dir} should be removed`);
  }
  for (const dir of protectedRootDirs) {
    assert.equal(exists(root, dir), true, `${dir} should be preserved`);
  }

  assert.equal(exists(root, 'Partitions', 'lampa', 'Cache'), false);
  assert.equal(exists(root, 'Partitions', 'lampa', 'Code Cache'), false);
  assert.equal(exists(root, 'Partitions', 'lampa', 'GPUCache'), false);
  assert.equal(exists(root, 'Partitions', 'lampa', 'DawnWebGPUCache'), false);
  assert.equal(exists(root, 'Partitions', 'lampa', 'ShaderCache'), false);
  assert.equal(exists(root, 'Partitions', 'lampa', 'VideoDecodeStats'), false);
  assert.equal(exists(root, 'Partitions', 'lampa', 'Cookies'), true);
  assert.equal(exists(root, 'Partitions', 'lampa', 'Local Storage'), true);
  assert.equal(exists(root, 'Partitions', 'lampa', 'IndexedDB'), true);
  assert.equal(exists(root, 'Partitions', 'lampa', 'Preferences'), true);
  assert.equal(exists(root, 'Partitions', 'lampa', 'Session Storage'), true);
  assert.equal(exists(root, 'Partitions', 'okko'), false);
});
