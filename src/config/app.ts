const rawAppBaseUrl = process.env.APP_BASE_URL;

if (!rawAppBaseUrl) {
  throw new Error('APP_BASE_URL is not defined in the environment variables');
}

let normalizedAppBaseUrl: string;

try {
  normalizedAppBaseUrl = new URL(rawAppBaseUrl).toString().replace(/\/$/, '');
} catch {
  throw new Error('APP_BASE_URL must be a valid absolute URL');
}

export const APP_BASE_URL = normalizedAppBaseUrl;
