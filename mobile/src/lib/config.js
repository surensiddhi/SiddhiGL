// SiddhiGL Mobile — app settings from the build (.env.local)
export const WORKER = (import.meta.env.VITE_WORKER_URL ?? '').replace(/\/+$/, '');
export const APP_VERSION = '0.3.0';
