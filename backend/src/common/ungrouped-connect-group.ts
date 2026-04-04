import type { PrismaService } from '../prisma/prisma.service';

/** Служебная группа: новые коннекты из подписки без тегов попадают сюда; имя нельзя занять вручную. */
export const UNGROUPED_CONNECT_GROUP_NAME = 'Без группы';

export function isReservedUngroupedConnectGroupName(name: string): boolean {
  return name.trim().normalize('NFC') === UNGROUPED_CONNECT_GROUP_NAME;
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
