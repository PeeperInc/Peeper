export const FALLBACK_ASSET_VERSION = '20260330-1';
let runtimeAssetVersion = FALLBACK_ASSET_VERSION;

export function setAssetVersion(nextVersion) {
  runtimeAssetVersion = String(nextVersion || FALLBACK_ASSET_VERSION);
}

export function getAssetVersion() {
  return runtimeAssetVersion;
}

export function assetUrl(path) {
  if (!path) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}v=${encodeURIComponent(runtimeAssetVersion)}`;
}
