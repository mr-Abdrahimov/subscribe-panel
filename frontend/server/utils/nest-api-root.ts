import type { H3Event } from 'h3';

type RuntimeConfigLike = {
  apiInternalBaseUrl?: string;
  public: { apiBaseUrl: string };
};

/** База URL Nest (без /api): на сервере предпочтительно внутренний адрес PM2 backend */
export function getNestApiRoot(event: H3Event): string {
  const config = useRuntimeConfig(event) as RuntimeConfigLike;
  const internal = (config.apiInternalBaseUrl ?? '').replace(/\/$/, '');
  const publicBase = config.public.apiBaseUrl.replace(/\/$/, '');
  return internal || publicBase;
}
