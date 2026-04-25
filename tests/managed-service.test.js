const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ensureManagedServiceRunning,
  firstMissingPath,
  readPidFile,
  stopManagedService,
} = require('../managed-service');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tv-electron-service-'));
}

test('readPidFile returns parsed pid or null', () => {
  const dir = makeTempDir();
  const pidFile = path.join(dir, 'service.pid');

  assert.equal(readPidFile(pidFile), null);
  fs.writeFileSync(pidFile, '12345\n', 'utf8');
  assert.equal(readPidFile(pidFile), 12345);
  fs.writeFileSync(pidFile, 'not-a-number', 'utf8');
  assert.equal(readPidFile(pidFile), null);
});

test('firstMissingPath returns first absent path', () => {
  const dir = makeTempDir();
  const existing = path.join(dir, 'exists');
  const missing = path.join(dir, 'missing');
  fs.writeFileSync(existing, '', 'utf8');

  assert.equal(firstMissingPath([existing, missing]), missing);
  assert.equal(firstMissingPath([existing]), null);
});

test('ensureManagedServiceRunning returns existing service without spawning', () => {
  let spawnCalled = false;
  const { result, runtime } = ensureManagedServiceRunning({
    name: 'Example',
    command: 'example',
    healthUrl: 'http://127.0.0.1:1000/',
  }, {
    isReachable: () => true,
    spawn: () => {
      spawnCalled = true;
      throw new Error('spawn should not be called');
    },
  });

  assert.equal(spawnCalled, false);
  assert.equal(runtime, null);
  assert.equal(result.ok, true);
  assert.equal(result.source, 'existing');
});

test('ensureManagedServiceRunning spawns and writes pid after health succeeds', () => {
  const dir = makeTempDir();
  const command = path.join(dir, 'service-bin');
  const pidFile = path.join(dir, 'service.pid');
  const logFile = path.join(dir, 'service.log');
  fs.writeFileSync(command, '', 'utf8');

  let reachabilityChecks = 0;
  let spawnCall = null;
  const { result, runtime } = ensureManagedServiceRunning({
    name: 'Example',
    command,
    args: ['--port', '1234'],
    cwd: dir,
    healthUrl: 'http://127.0.0.1:1234/',
    pidFile,
    logFile,
    requiredPaths: [command],
    waitAttempts: 1,
    waitMs: 0,
  }, {
    isReachable: () => {
      reachabilityChecks += 1;
      return reachabilityChecks > 1;
    },
    spawn: (spawnCommand, spawnArgs, options) => {
      spawnCall = { spawnCommand, spawnArgs, options };
      return { pid: 4242, unref() {} };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'spawned');
  assert.equal(result.pid, 4242);
  assert.equal(runtime.ownsProcess, true);
  assert.equal(fs.readFileSync(pidFile, 'utf8'), '4242');
  assert.equal(spawnCall.spawnCommand, command);
  assert.deepEqual(spawnCall.spawnArgs, ['--port', '1234']);
  assert.equal(spawnCall.options.cwd, dir);
  assert.equal(fs.existsSync(logFile), true);
});

test('ensureManagedServiceRunning reports missing required path', () => {
  const dir = makeTempDir();
  const missing = path.join(dir, 'missing-bin');

  const { result, runtime } = ensureManagedServiceRunning({
    name: 'Example',
    command: missing,
    healthUrl: 'http://127.0.0.1:1000/',
    requiredPaths: [missing],
  }, {
    isReachable: () => false,
    spawn: () => {
      throw new Error('spawn should not be called');
    },
  });

  assert.equal(runtime, null);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-files');
  assert.equal(result.missingPath, missing);
});

test('stopManagedService kills owned process group once', () => {
  const originalKill = process.kill;
  const calls = [];
  process.kill = (pid, signal) => {
    calls.push({ pid, signal });
    return true;
  };

  try {
    const runtime = { pid: 4242, ownsProcess: true };
    assert.deepEqual(stopManagedService(runtime), {
      ok: true,
      stopped: true,
      pid: 4242,
      signal: 'SIGTERM',
    });
    assert.equal(runtime.ownsProcess, false);
    assert.deepEqual(calls, [{ pid: -4242, signal: 'SIGTERM' }]);
    assert.equal(stopManagedService(runtime).stopped, false);
  } finally {
    process.kill = originalKill;
  }
});
