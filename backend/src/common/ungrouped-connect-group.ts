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
  const exists = await prisma.group.findUnique({
    where: { name: UNGROUPED_CONNECT_GROUP_NAME },
  });
  if (exists) {
    return;
  }
  const agg = await prisma.group.aggregate({ _max: { sortOrder: true } });
  await prisma.group.create({
    data: {
      name: UNGROUPED_CONNECT_GROUP_NAME,
      isMainGroup: false,
      sortOrder: (agg._max.sortOrder ?? -1) + 1,
    },
  });
}
