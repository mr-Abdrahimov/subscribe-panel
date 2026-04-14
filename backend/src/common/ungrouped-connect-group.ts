import type { PrismaService } from '../prisma/prisma.service';

/** Служебная группа: новые коннекты из подписки без тегов попадают сюда; имя нельзя занять вручную. */
export const UNGROUPED_CONNECT_GROUP_NAME = 'Без группы';

export function isReservedUngroupedConnectGroupName(name: string): boolean {
  return name.trim().normalize('NFC') === UNGROUPED_CONNECT_GROUP_NAME;
}

/**
 * Перед сохранением groupNames коннекта: пустой список → только «Без группы»;
 * если указаны «Без группы» и хотя бы ещё одна группа — служебный тег убирается.
 */
export function normalizeConnectGroupNamesForStorage(input: string[]): string[] {
  const uniq = Array.from(
    new Set(input.map((n) => n.trim()).filter((n) => n.length > 0)),
  );
  if (uniq.length === 0) {
    return [UNGROUPED_CONNECT_GROUP_NAME];
  }
  const hasUngrouped = uniq.some((n) => isReservedUngroupedConnectGroupName(n));
  if (hasUngrouped && uniq.length > 1) {
    return uniq.filter((n) => !isReservedUngroupedConnectGroupName(n));
  }
  return uniq;
}

export async function ensureUngroupedConnectGroupExists(
  prisma: PrismaService,
): Promise<void> {
  // upsert вместо findUnique+create — атомарно, не создаёт дубликат при гонке параллельных вызовов.
  const agg = await prisma.group.aggregate({ _max: { sortOrder: true } });
  await prisma.group.upsert({
    where: { name: UNGROUPED_CONNECT_GROUP_NAME },
    update: {},
    create: {
      name: UNGROUPED_CONNECT_GROUP_NAME,
      isMainGroup: false,
      sortOrder: (agg._max.sortOrder ?? -1) + 1,
    },
  });
}

/**
 * Удаляет лишние дубликаты группы «Без группы», оставляя только одну с наименьшим sortOrder.
 * Вызывается при старте приложения для исправления данных после гонки.
 */
export async function deduplicateUngroupedConnectGroup(
  prisma: PrismaService,
): Promise<void> {
  const all = await prisma.group.findMany({
    where: { name: UNGROUPED_CONNECT_GROUP_NAME },
    orderBy: { sortOrder: 'asc' },
  });
  if (all.length <= 1) {
    return;
  }
  // Оставляем первую (наименьший sortOrder), удаляем остальные
  const [, ...duplicates] = all;
  await prisma.group.deleteMany({
    where: { id: { in: duplicates.map((g) => g.id) } },
  });
}
