#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LABEL = 'com.stepan.lampawrapper';
const DEFAULT_APP_PATH = '/Applications/Lampa Wrapper.app';

function usage() {
  console.error('Usage: node scripts/autostart.js <install|remove|status> [app-path]');
  process.exit(2);
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function guiDomain() {
  return `gui/${process.getuid()}`;
}

function launchAgentDir() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents');
}

function launchAgentPath() {
  return path.join(launchAgentDir(), `${LABEL}.plist`);
}

function logDir() {
  return path.join(os.homedir(), 'Library', 'Logs', 'Lampa Wrapper');
}

function createPlist(appPath) {
  const logs = logDir();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>${xmlEscape(appPath)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logs, 'launch-agent.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logs, 'launch-agent.err.log'))}</string>
</dict>
</plist>
`;
}

function printCommandFailure(action, result) {
  const details = (result.stderr || result.stdout || '').trim();
  if (details) console.error(`${action}: ${details}`);
}

function unloadIfRegistered() {
  const labelResult = run('launchctl', ['bootout', guiDomain(), `${guiDomain()}/${LABEL}`]);
  if (labelResult.ok) return;

  const plistResult = run('launchctl', ['bootout', guiDomain(), launchAgentPath()]);
  if (!plistResult.ok && !/No such process|Could not find service|Input\/output error/i.test(plistResult.stderr)) {
    printCommandFailure('launchctl bootout', plistResult);
  }
}

function install(appPath = DEFAULT_APP_PATH) {
  if (process.platform !== 'darwin') {
    console.error('Autostart is only supported on macOS.');
    process.exit(1);
  }
  if (!fs.existsSync(appPath)) {
    console.error(`App bundle not found: ${appPath}`);
    process.exit(1);
  }

  fs.mkdirSync(launchAgentDir(), { recursive: true });
  fs.mkdirSync(logDir(), { recursive: true });
  unloadIfRegistered();
  fs.writeFileSync(launchAgentPath(), createPlist(appPath), 'utf8');

  const bootstrap = run('launchctl', ['bootstrap', guiDomain(), launchAgentPath()]);
  if (!bootstrap.ok) {
    printCommandFailure('launchctl bootstrap', bootstrap);
    process.exit(1);
  }

  console.log(`Autostart installed: ${launchAgentPath()}`);
}

function remove() {
  unloadIfRegistered();
  try {
    fs.unlinkSync(launchAgentPath());
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  console.log(`Autostart removed: ${launchAgentPath()}`);
}

function status() {
  const plistExists = fs.existsSync(launchAgentPath());
  const print = run('launchctl', ['print', `${guiDomain()}/${LABEL}`]);
  console.log(`plist: ${plistExists ? launchAgentPath() : 'missing'}`);
  console.log(`launchctl: ${print.ok ? 'loaded' : 'not loaded'}`);
  if (print.ok) {
    const firstLines = print.stdout.trim().split('\n').slice(0, 12).join('\n');
    if (firstLines) console.log(firstLines);
  }
}

const [command, appPath] = process.argv.slice(2);
if (!command) usage();

if (command === 'install') install(appPath);
else if (command === 'remove') remove();
else if (command === 'status') status();
else usage();
