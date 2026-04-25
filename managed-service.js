const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readPidFile(pidFile, fsImpl = fs) {
  try {
    if (!pidFile || !fsImpl.existsSync(pidFile)) return null;
    return parseInt(fsImpl.readFileSync(pidFile, 'utf8').trim(), 10) || null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isHttpUrlReachable(url, execFile = execFileSync) {
  if (!url) return false;
  try {
    execFile('curl', ['-fsS', '--max-time', '2', url], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function firstMissingPath(paths, fsImpl = fs) {
  return (paths || []).find((candidate) => !fsImpl.existsSync(candidate)) || null;
}

function openLogFile(logFile, fsImpl = fs) {
  if (!logFile) return 'ignore';
  fsImpl.mkdirSync(path.dirname(logFile), { recursive: true });
  return fsImpl.openSync(logFile, 'a');
}

function closeLogFile(logFileDescriptor, fsImpl = fs) {
  if (typeof logFileDescriptor !== 'number') return;
  try {
    fsImpl.closeSync(logFileDescriptor);
  } catch {}
}

function waitForHealth(service, deps) {
  const attempts = service.waitAttempts ?? 10;
  const waitMs = service.waitMs ?? 300;
  for (let i = 0; i < attempts; i += 1) {
    sleepSync(waitMs);
    if (deps.isReachable(service.healthUrl)) return true;
  }
  return false;
}

function ensureManagedServiceRunning(service, deps = {}) {
  const fsImpl = deps.fs || fs;
  const spawnImpl = deps.spawn || spawn;
  const isReachable = deps.isReachable || ((url) => isHttpUrlReachable(url, deps.execFileSync || execFileSync));
  const serviceDeps = { ...deps, fs: fsImpl, spawn: spawnImpl, isReachable };

  const missingPath = firstMissingPath(service.requiredPaths, fsImpl);
  if (missingPath) {
    return {
      result: { ok: false, reason: 'missing-files', service: service.name, missingPath, url: service.healthUrl },
      runtime: null,
    };
  }

  (service.ensureDirs || []).forEach((dir) => {
    fsImpl.mkdirSync(dir, { recursive: true });
  });

  if (isReachable(service.healthUrl)) {
    return {
      result: { ok: true, running: true, source: 'existing', service: service.name, url: service.healthUrl },
      runtime: null,
    };
  }

  const pid = readPidFile(service.pidFile, fsImpl);
  if (pid && isProcessAlive(pid) && isReachable(service.healthUrl)) {
    return {
      result: { ok: true, running: true, source: 'pidfile', service: service.name, pid, url: service.healthUrl },
      runtime: null,
    };
  }

  const logFileDescriptor = openLogFile(service.logFile, fsImpl);
  let child;
  try {
    child = spawnImpl(service.command, service.args || [], {
      cwd: service.cwd,
      detached: service.detached !== false,
      stdio: ['ignore', logFileDescriptor, logFileDescriptor],
    });
  } catch (error) {
    closeLogFile(logFileDescriptor, fsImpl);
    return {
      result: {
        ok: false,
        reason: 'spawn-failed',
        service: service.name,
        error: String(error?.message || error),
        url: service.healthUrl,
        logFile: service.logFile,
      },
      runtime: null,
    };
  }
  closeLogFile(logFileDescriptor, fsImpl);

  if (typeof child.on === 'function') child.on('error', () => {});
  if (typeof child.unref === 'function') child.unref();
  if (service.pidFile && child.pid) {
    fsImpl.mkdirSync(path.dirname(service.pidFile), { recursive: true });
    fsImpl.writeFileSync(service.pidFile, String(child.pid), 'utf8');
  }

  const runtime = { service, child, pid: child.pid, ownsProcess: true };
  if (waitForHealth(service, serviceDeps)) {
    return {
      result: { ok: true, running: true, source: 'spawned', service: service.name, pid: child.pid, url: service.healthUrl },
      runtime,
    };
  }

  return {
    result: {
      ok: false,
      reason: 'start-failed',
      service: service.name,
      pid: child.pid,
      url: service.healthUrl,
      logFile: service.logFile,
    },
    runtime,
  };
}

function killOwnedProcess(pid, signal = 'SIGTERM') {
  if (!pid) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

function stopManagedService(runtime, options = {}) {
  if (!runtime || !runtime.ownsProcess || !runtime.pid) {
    return { ok: true, stopped: false, reason: 'not-owned' };
  }

  const signal = options.signal || 'SIGTERM';
  const stopped = killOwnedProcess(runtime.pid, signal);
  runtime.ownsProcess = false;
  return { ok: stopped, stopped, pid: runtime.pid, signal };
}

module.exports = {
  ensureManagedServiceRunning,
  firstMissingPath,
  isHttpUrlReachable,
  isProcessAlive,
  readPidFile,
  stopManagedService,
};
