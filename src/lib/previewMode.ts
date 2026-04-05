const PREVIEW_QUERY_KEY = 'preview';
const PREVIEW_STORAGE_KEY = 'bizzybee.localPreview';

export const isLocalhost = () => {
  if (typeof window === 'undefined') return false;

  return window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
};

export const isPreviewModeEnabled = () => {
  if (typeof window === 'undefined' || !isLocalhost()) return false;

  const params = new URLSearchParams(window.location.search);
  const queryValue = params.get(PREVIEW_QUERY_KEY);

  if (queryValue === '1' || queryValue === 'true') {
    window.localStorage.setItem(PREVIEW_STORAGE_KEY, '1');
    return true;
  }

  return window.localStorage.getItem(PREVIEW_STORAGE_KEY) === '1';
};

export const enablePreviewMode = () => {
  if (typeof window === 'undefined' || !isLocalhost()) return;

  window.localStorage.setItem(PREVIEW_STORAGE_KEY, '1');
};

export const disablePreviewMode = () => {
  if (typeof window === 'undefined') return;

  window.localStorage.removeItem(PREVIEW_STORAGE_KEY);
};

export const getPreviewAwarePath = (path: string) => {
  if (!isPreviewModeEnabled()) {
    return path;
  }

  if (!path.startsWith('/')) {
    return path;
  }

  const [pathname, hash = ''] = path.split('#');
  const separator = pathname.includes('?') ? '&' : '?';
  const nextPath = pathname.includes('preview=1') ? pathname : `${pathname}${separator}preview=1`;

  return hash ? `${nextPath}#${hash}` : nextPath;
};
