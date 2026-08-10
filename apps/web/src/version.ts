declare const __DDNS_APP_VERSION__: string | undefined;

const configuredVersion =
  typeof __DDNS_APP_VERSION__ === 'string' ? __DDNS_APP_VERSION__.trim() : '';

export const APP_VERSION = configuredVersion || '1.0.0';
