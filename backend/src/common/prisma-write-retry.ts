import { Prisma } from '@prisma/client';

/** Конфликт записи / deadlock в MongoDB через Prisma */
const PRISMA_WRITE_CONFLICT = 'P2034';

function isWriteConflict(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === PRISMA_WRITE_CONFLICT
  );
}

/**
 * Повтор при P2034 (типично для MongoDB при паралельных обновлениях одной записи).
 */
export async function withPrismaWriteRetry<T>(
  run: () => Promise<T>,
  opts?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<T> {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 6);
  const baseDelayMs = Math.max(10, opts?.baseDelayMs ?? 40);
  let last: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await run();
    } catch (e) {
      last = e;
      if (isWriteConflict(e) && attempt < maxAttempts) {
        const delay = baseDelayMs * attempt + Math.floor(Math.random() * 30);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw last;
}
