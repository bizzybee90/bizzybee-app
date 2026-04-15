const PREVIEW_QUERY_KEY = 'preview';
const PREVIEW_STORAGE_KEY = 'bizzybee.localPreview';
const ONBOARDING_HANDOFF_KEY = 'bizzybee.onboardingHandoff';

export interface OnboardingHandoffPayload {
  step?: string;
  businessContext?: {
    companyName?: string;
    businessType?: string;
    websiteUrl?: string;
    serviceArea?: string;
    emailDomain?: string;
    isHiring?: boolean;
    receivesInvoices?: boolean;
  };
}

export const isLocalhost = () => {
  if (typeof window === 'undefined') return false;

  return window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
};

export const isPreviewModeEnabled = () => {
  if (typeof window === 'undefined' || !isLocalhost()) return false;

  const params = new URLSearchParams(window.location.search);
  const queryValue = params.get(PREVIEW_QUERY_KEY);

  if (queryValue === '0' || queryValue === 'false') {
    window.localStorage.removeItem(PREVIEW_STORAGE_KEY);
    return false;
  }

  if (queryValue === '1' || queryValue === 'true') {
    window.localStorage.setItem(PREVIEW_STORAGE_KEY, '1');
    return true;
  }

  if (
    params.get('reset') === 'true' ||
    params.get('repair') === 'true' ||
    params.get('repair') === '1'
  ) {
    window.localStorage.removeItem(PREVIEW_STORAGE_KEY);
    return false;
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

export const setOnboardingHandoff = (payload: OnboardingHandoffPayload) => {
  if (typeof window === 'undefined') return;

  const serialized = JSON.stringify(payload);
  window.localStorage.setItem(ONBOARDING_HANDOFF_KEY, serialized);
  window.sessionStorage.setItem(ONBOARDING_HANDOFF_KEY, serialized);
};

export const readOnboardingHandoff = (): OnboardingHandoffPayload | null => {
  if (typeof window === 'undefined') return null;

  const raw =
    window.sessionStorage.getItem(ONBOARDING_HANDOFF_KEY) ||
    window.localStorage.getItem(ONBOARDING_HANDOFF_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as OnboardingHandoffPayload;
  } catch {
    return null;
  }
};

export const clearOnboardingHandoff = () => {
  if (typeof window === 'undefined') return;

  window.sessionStorage.removeItem(ONBOARDING_HANDOFF_KEY);
  window.localStorage.removeItem(ONBOARDING_HANDOFF_KEY);
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
