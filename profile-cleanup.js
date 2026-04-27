const fs = require('fs');
const path = require('path');

const CACHE_DIR_NAMES = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
]);

const PARTITION_CACHE_DIR_NAMES = new Set([
  ...CACHE_DIR_NAMES,
  'ShaderCache',
  'VideoDecodeStats',
]);

const OBSOLETE_PARTITIONS = ['okko'];

function isDawnCacheDirName(name) {
  return /^Dawn.*Cache$/.test(name);
}

function isRemovableCacheDirName(name) {
  return PARTITION_CACHE_DIR_NAMES.has(name) || isDawnCacheDirName(name);
}

function isRemovableCommonCacheDirName(name) {
  return CACHE_DIR_NAMES.has(name) || isDawnCacheDirName(name);
}

function listExistingCacheDirs(root, canRemoveDirName) {
  if (!root || !fs.existsSync(root)) return [];

  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && canRemoveDirName(entry.name))
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function getPartitionDir(userDataRoot, partitionName) {
  return path.join(userDataRoot, 'Partitions', partitionName);
}

function getPersistentPartitionDirs(userDataRoot) {
  const partitionsRoot = path.join(userDataRoot, 'Partitions');
  if (!fs.existsSync(partitionsRoot)) return [];

  try {
    return fs.readdirSync(partitionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !OBSOLETE_PARTITIONS.includes(entry.name))
      .map((entry) => path.join(partitionsRoot, entry.name));
  } catch {
    return [];
  }
}

function getProfileCleanupTargets(userDataRoot) {
  const targets = [
    ...OBSOLETE_PARTITIONS.map((name) => getPartitionDir(userDataRoot, name)),
    ...listExistingCacheDirs(userDataRoot, isRemovableCommonCacheDirName),
  ];

  for (const partitionDir of getPersistentPartitionDirs(userDataRoot)) {
    targets.push(...listExistingCacheDirs(partitionDir, isRemovableCacheDirName));
  }

  return [...new Set(targets)];
}

function removePathIfExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return { path: targetPath, removed: false, missing: true };
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  return { path: targetPath, removed: true };
}

function cleanObsoleteProfileData(userDataRoot) {
  const results = [];

  for (const targetPath of getProfileCleanupTargets(userDataRoot)) {
    try {
      results.push(removePathIfExists(targetPath));
    } catch (error) {
      results.push({
        path: targetPath,
        removed: false,
        error: error && error.message ? error.message : String(error),
      });
    }
  }

  return results;
}

module.exports = {
  cleanObsoleteProfileData,
  getProfileCleanupTargets,
  isRemovableCommonCacheDirName,
  isRemovableCacheDirName,
};
