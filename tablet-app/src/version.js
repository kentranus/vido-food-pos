/**
 * version.js — auto-injected by GitHub Actions before build.
 */
export const APP_VERSION  = '2.1.0-pro';
export const BUILD_DATE   = '__BUILD_DATE__';
export const COMMIT_SHA   = '__COMMIT_SHA__';
export const COMMIT_SHORT = '__COMMIT_SHORT__';
export const BUILD_NUMBER = '__BUILD_NUMBER__';

export function getBuildLabel() {
  const date = BUILD_DATE === '__BUILD_DATE__' ? 'dev' : BUILD_DATE.split('T')[0];
  const sha = COMMIT_SHORT === '__COMMIT_SHORT__' ? 'local' : COMMIT_SHORT;
  return `v${APP_VERSION} · ${date} · ${sha}`;
}
