const EXTERNAL_PLAYER_PROTOCOLS = new Set([
  'iina:',
  'infuse:',
  'mpv:',
  'nplayer-http:',
  'nplayer-https:',
  'open-vidhub:',
  'senplayer:',
  'svplayer:',
  'tracy:',
  'vlc:',
  'vlc-x-callback:',
]);

function getUrlProtocol(rawUrl) {
  if (!rawUrl) return '';

  try {
    return new URL(String(rawUrl)).protocol.toLowerCase();
  } catch {
    const match = String(rawUrl).match(/^([a-z][a-z0-9+.-]*):/i);
    return match ? `${match[1].toLowerCase()}:` : '';
  }
}

function isExternalPlayerUrl(rawUrl) {
  return EXTERNAL_PLAYER_PROTOCOLS.has(getUrlProtocol(rawUrl));
}

function getIinaMediaUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl));
    if (url.protocol.toLowerCase() !== 'iina:') return '';

    return url.searchParams.get('url') || '';
  } catch {
    return '';
  }
}

module.exports = {
  EXTERNAL_PLAYER_PROTOCOLS,
  getIinaMediaUrl,
  getUrlProtocol,
  isExternalPlayerUrl,
};
