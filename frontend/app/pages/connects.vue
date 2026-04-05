<script setup lang="ts">
import type { RowSelectionState } from '@tanstack/table-core';
import Sortable from 'sortablejs';
import type { SortableEvent } from 'sortablejs';

definePageMeta({
  layout: 'dashboard'
});

/** Ключ колонки для коннектов без главной группы (визуальная «Без группы») */
const NO_MAIN_BUCKET = '__no_main__';

/** Как на бэкенде: служебная группа для коннектов без явных тегов */
const UNGROUPED_CONNECT_GROUP_NAME = 'Без группы';

function isUngroupedGroupLabel(name: string): boolean {
  return name === UNGROUPED_CONNECT_GROUP_NAME;
}

function isMainGroupLabel(name: string): boolean {
  return groups.value.some((g) => g.name === name && g.isMainGroup === true);
}

type ConnectRow = {
  id: string;
  originalName: string;
  name: string;
  /** Строка из подписки: vless://, vmess:// и т.д. */
  raw: string;
  groupNames: string[];
  status: 'ACTIVE' | 'INACTIVE';
  protocol: string;
  createdAt: string;
  hidden: boolean;
  tags: string[];
  sortOrder: number;
  subscription: {
    id: string;
    title: string;
  };
};

type GroupItem = {
  id: string;
  name: string;
  sortOrder?: number;
  createdAt: string;
  isMainGroup?: boolean;
  subscriptionDisplayName?: string | null;
};

const config = useRuntimeConfig();
const toast = useToast();
const loading = ref(false);
const connects = ref<ConnectRow[]>([]);
const groups = ref<GroupItem[]>([]);

const isGroupModalOpen = ref(false);
const selectedGroupConnectId = ref<string | null>(null);
const selectedGroupNames = ref<string[]>([]);
const isNameModalOpen = ref(false);
const selectedNameConnectId = ref<string | null>(null);
const editNameValue = ref('');
const isDeleteConfirmOpen = ref(false);
const deleteConnectId = ref<string | null>(null);

const rowSelection = ref<RowSelectionState>({});
const bulkGroupNames = ref<string[]>([]);
const bulkLoading = ref(false);
/** Снимок порядка по колонкам до начала перетаскивания (для переноса нескольких выбранных) */
let preDragBucketOrder: Record<string, string[]> | null = null;

/** null — все подписки */
const filterSubscriptionId = ref<string | null>(null);
const filterStatus = ref<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
/** null — любая группа (фильтр не задан) */
const filterGroupName = ref<string | null>(null);

/** Подстрока в кастомном или исходном названии; без учёта регистра; вместе с прочими фильтрами ограничивает видимые карточки */
const connectSearchQuery = ref('');

const statusFilterItems = [
  { label: 'Любой', id: 'ALL' as const },
  { label: 'Включён', id: 'ACTIVE' as const },
  { label: 'Отключён', id: 'INACTIVE' as const },
];

const subscriptionFilterItems = computed(() => {
  const map = new Map<string, string>();
  for (const c of connects.value) {
    map.set(c.subscription.id, c.subscription.title);
  }
  const rest = [...map.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'ru'))
    .map(([id, title]) => ({ label: title, id }));
  return [{ label: 'Все подписки', id: null }, ...rest];
});

const groupFilterItems = computed(() => {
  const rest = groups.value
    .map((g) => ({
      label: g.isMainGroup === true ? `${g.name} · главная` : g.name,
      id: g.name
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  return [{ label: 'Любая группа', id: null }, ...rest];
});

const mainGroupNameSet = computed(
  () => new Set(groups.value.filter((g) => g.isMainGroup === true).map((g) => g.name)),
);

function countMainGroupsInNames(names: string[]): number {
  let n = 0;
  for (const x of names) {
    if (mainGroupNameSet.value.has(x)) {
      n += 1;
    }
  }
  return n;
}

function fetchErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'data' in err) {
    const d = (err as { data?: { message?: unknown } }).data?.message;
    if (typeof d === 'string') {
      return d;
    }
    if (Array.isArray(d)) {
      return d.join(', ');
    }
  }
  return fallback;
}

const connectSearchNeedle = computed(() =>
  connectSearchQuery.value.trim().toLowerCase(),
);

const filtersActive = computed(
  () =>
    filterSubscriptionId.value != null ||
    filterStatus.value !== 'ALL' ||
    filterGroupName.value != null ||
    connectSearchNeedle.value.length > 0,
);

function connectMatchesNameSearch(c: ConnectRow, needleLower: string): boolean {
  if (!needleLower) {
    return true;
  }
  const name = (c.name ?? '').toLowerCase();
  const orig = (c.originalName ?? '').toLowerCase();
  return name.includes(needleLower) || orig.includes(needleLower);
}

const filteredConnects = computed(() => {
  let list = connects.value;
  if (filterSubscriptionId.value != null) {
    list = list.filter((c) => c.subscription.id === filterSubscriptionId.value);
  }
  if (filterStatus.value !== 'ALL') {
    list = list.filter((c) => c.status === filterStatus.value);
  }
  if (filterGroupName.value != null) {
    const g = filterGroupName.value;
    list = list.filter((c) => c.groupNames.includes(g));
  }
  const needle = connectSearchNeedle.value;
  if (needle.length > 0) {
    list = list.filter((c) => connectMatchesNameSearch(c, needle));
  }
  return list;
});

const tableEmptyText = computed(() => {
  if (connects.value.length === 0) {
    return 'Коннектов пока нет';
  }
  if (filteredConnects.value.length === 0) {
    if (connectSearchNeedle.value.length > 0) {
      return 'Нет коннектов по поиску и фильтрам';
    }
    return 'Нет коннектов по выбранным фильтрам';
  }
  return 'Коннектов пока нет';
});

const selectedConnectsCount = computed(
  () => Object.values(rowSelection.value).filter(Boolean).length,
);

/** Главные группы по sortOrder (для сборки содержимого колонок). */
const mainGroupsSorted = computed(() =>
  [...groups.value]
    .filter((g) => g.isMainGroup === true)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
);

/**
 * Порядок колонок как на странице «Группы»: общий sortOrder, между главными — слот «Без группы»
 * в позиции системной группы (не в конце).
 */
const bucketKeysOrdered = computed(() => {
  const ordered = [...groups.value].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
  const keys: string[] = [];
  for (const g of ordered) {
    if (g.isMainGroup === true) {
      keys.push(`m:${g.id}`);
    } else if (isUngroupedGroupLabel(g.name)) {
      keys.push(NO_MAIN_BUCKET);
    }
  }
  if (!keys.includes(NO_MAIN_BUCKET)) {
    keys.push(NO_MAIN_BUCKET);
  }
  return keys;
});

/** bucketKey → порядок id коннектов (только из текущего фильтра) */
const bucketOrder = ref<Record<string, string[]>>({});

/** Режим сортировки внутри колонки (главная группа / «Без группы»). «panel» — порядок из БД; после ручного drag сбрасывается в panel. */
type BucketConnectSortMode =
  | 'panel'
  | 'name_az'
  | 'name_za'
  | 'subscription_az'
  | 'subscription_za';

const bucketConnectSortMode = ref<Record<string, BucketConnectSortMode>>({});

const connectBucketSortMenuItems: {
  id: BucketConnectSortMode | 'random';
  label: string;
}[] = [
  { id: 'panel', label: 'Как в панели' },
  { id: 'name_az', label: 'По названию А → Я' },
  { id: 'name_za', label: 'По названию Я → А' },
  { id: 'subscription_az', label: 'По подписке А → Я' },
  { id: 'subscription_za', label: 'По подписке Я → А' },
  { id: 'random', label: 'Случайно' },
];

const bucketListEls: Record<string, HTMLElement | undefined> = {};
let bucketSortableInstances: Sortable[] = [];

function bindBucketListEl(key: string, el: unknown) {
  if (el instanceof HTMLElement) {
    bucketListEls[key] = el;
  } else {
    delete bucketListEls[key];
  }
}

function compareConnectsForBucket(a: ConnectRow, b: ConnectRow): number {
  const d = a.sortOrder - b.sortOrder;
  if (d !== 0) {
    return d;
  }
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

const connectNameCollator = new Intl.Collator('ru', { sensitivity: 'base' });

function sortConnectIdsForBucketMode(
  ids: string[],
  mode: Exclude<BucketConnectSortMode, 'panel'>,
): string[] {
  type Row = { id: string; c: ConnectRow | undefined };
  const rows: Row[] = ids.map((id) => ({ id, c: connectById(id) }));
  const nameKey = (r: Row) =>
    (r.c?.name ?? r.c?.originalName ?? r.id).trim();
  const subKey = (r: Row) => (r.c?.subscription.title ?? '').trim();

  const cmpName = (a: Row, b: Row) => connectNameCollator.compare(nameKey(a), nameKey(b));
  const cmpSub = (a: Row, b: Row) => {
    const d = connectNameCollator.compare(subKey(a), subKey(b));
    if (d !== 0) {
      return d;
    }
    return cmpName(a, b);
  };

  const arr = [...rows];
  switch (mode) {
    case 'name_az':
      arr.sort(cmpName);
      break;
    case 'name_za':
      arr.sort((a, b) => cmpName(b, a));
      break;
    case 'subscription_az':
      arr.sort(cmpSub);
      break;
    case 'subscription_za':
      arr.sort((a, b) => cmpSub(b, a));
      break;
    default:
      return ids;
  }
  return arr.map((r) => r.id);
}

/** После базовой сборки колонок — применить сохранённые режимы сортировки (кроме «panel»). */
function applyBucketConnectSortModes() {
  const modes = bucketConnectSortMode.value;
  const out = { ...bucketOrder.value };
  let changed = false;
  for (const key of bucketKeysOrdered.value) {
    const mode = modes[key] ?? 'panel';
    if (mode === 'panel') {
      continue;
    }
    const ids = [...(out[key] ?? [])];
    if (ids.length < 2) {
      continue;
    }
    const sorted = sortConnectIdsForBucketMode(ids, mode);
    if (sorted.join() !== ids.join()) {
      changed = true;
    }
    out[key] = sorted;
  }
  if (changed) {
    bucketOrder.value = out;
  }
}

function rebuildBucketOrder() {
  const list = filteredConnects.value;
  const next: Record<string, string[]> = {};
  for (const g of mainGroupsSorted.value) {
    const key = `m:${g.id}`;
    next[key] = list
      .filter((c) => c.groupNames.includes(g.name))
      .sort(compareConnectsForBucket)
      .map((c) => c.id);
  }
  next[NO_MAIN_BUCKET] = list
    .filter((c) => !c.groupNames.some((n) => mainGroupNameSet.value.has(n)))
    .sort(compareConnectsForBucket)
    .map((c) => c.id);
  bucketOrder.value = next;
  applyBucketConnectSortModes();
}

function getBucketConnectSortMode(bucketKey: string): BucketConnectSortMode {
  return bucketConnectSortMode.value[bucketKey] ?? 'panel';
}

function clearConnectSortModeForBuckets(...bucketKeys: string[]) {
  const next = { ...bucketConnectSortMode.value };
  for (const k of bucketKeys) {
    if (k) {
      next[k] = 'panel';
    }
  }
  bucketConnectSortMode.value = next;
}

function shuffleConnectIds(ids: string[]): string[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function onConnectBucketSortPick(bucketKey: string, value: unknown) {
  if (filtersActive.value) {
    return;
  }
  const mode =
    typeof value === 'string'
      ? value
      : value &&
          typeof value === 'object' &&
          value !== null &&
          'id' in value &&
          typeof (value as { id: unknown }).id === 'string'
        ? (value as { id: string }).id
        : null;
  if (mode == null) {
    return;
  }

  if (mode === 'random') {
    const ids = bucketOrder.value[bucketKey] ?? [];
    if (ids.length < 2) {
      toast.add({ title: 'В колонке меньше двух коннектов', color: 'warning' });
      return;
    }
    bucketOrder.value = {
      ...bucketOrder.value,
      [bucketKey]: shuffleConnectIds(ids),
    };
    clearConnectSortModeForBuckets(bucketKey);
    await persistGlobalOrderFromBuckets(false);
    toast.add({ title: 'Случайный порядок сохранён', color: 'success' });
    return;
  }

  bucketConnectSortMode.value = {
    ...bucketConnectSortMode.value,
    [bucketKey]: mode,
  };
  rebuildBucketOrder();
  await persistGlobalOrderFromBuckets(true);
}

function bucketColumnTitle(key: string): string {
  if (key === NO_MAIN_BUCKET) {
    return 'Без группы';
  }
  const id = key.startsWith('m:') ? key.slice(2) : '';
  const g = groups.value.find((x) => x.id === id);
  return g?.name ?? key;
}

function mainNameForBucketKey(key: string): string | null {
  if (key === NO_MAIN_BUCKET) {
    return null;
  }
  const id = key.startsWith('m:') ? key.slice(2) : '';
  return groups.value.find((x) => x.id === id)?.name ?? null;
}

function connectById(id: string): ConnectRow | undefined {
  return connects.value.find((c) => c.id === id);
}

function readConnectIdsFromListEl(el: HTMLElement): string[] {
  return [...el.querySelectorAll('[data-connect-id]')]
    .map((node) => (node as HTMLElement).dataset.connectId)
    .filter((x): x is string => Boolean(x));
}

function destroyBucketSortables() {
  for (const s of bucketSortableInstances) {
    s.destroy();
  }
  bucketSortableInstances = [];
}

function initBucketSortables() {
  destroyBucketSortables();
  if (filtersActive.value || loading.value) {
    return;
  }
  for (const key of bucketKeysOrdered.value) {
    const el = bucketListEls[key];
    if (!el) {
      continue;
    }
    const inst = Sortable.create(el, {
      group: { name: 'connects-main-buckets', pull: true, put: true },
      animation: 180,
      handle: '.connect-bucket-drag-handle',
      draggable: '[data-connect-row]',
      onStart: () => {
        preDragBucketOrder = JSON.parse(JSON.stringify(bucketOrder.value)) as Record<
          string,
          string[]
        >;
      },
      onEnd: (e) => {
        void onBucketSortEnd(e);
      },
    });
    bucketSortableInstances.push(inst);
  }
}

function computeGroupNamesForBucket(connect: ConnectRow, targetKey: string): string[] {
  const nonMain = connect.groupNames.filter((n) => !mainGroupNameSet.value.has(n));
  if (targetKey === NO_MAIN_BUCKET) {
    return nonMain;
  }
  const mainName = mainNameForBucketKey(targetKey);
  if (!mainName) {
    return nonMain;
  }
  return [...new Set([...nonMain, mainName])];
}

/** Порядок выбранных id по колонкам сверху вниз (как на экране до drag). */
function orderedSelectedIdsFromPre(
  pre: Record<string, string[]>,
  selectedSet: Set<string>,
): string[] {
  const out: string[] = [];
  for (const k of bucketKeysOrdered.value) {
    for (const id of pre[k] ?? []) {
      if (selectedSet.has(id)) {
        out.push(id);
      }
    }
  }
  return out;
}

/**
 * Несколько выбранных коннектов: Sortable двигает один DOM-элемент — восстанавливаем целевой порядок из снимка.
 */
function mergeMultiDragIntoBuckets(
  pre: Record<string, string[]>,
  selectedSet: Set<string>,
  toKey: string,
  insertAt: number,
): Record<string, string[]> {
  const keys = bucketKeysOrdered.value;
  const block = orderedSelectedIdsFromPre(pre, selectedSet);
  const work: Record<string, string[]> = {};
  for (const k of keys) {
    work[k] = (pre[k] ?? []).filter((id) => !selectedSet.has(id));
  }
  const L = work[toKey] ?? [];
  const at = Math.max(0, Math.min(insertAt, L.length));
  work[toKey] = [...L.slice(0, at), ...block, ...L.slice(at)];
  return work;
}

async function onBucketSortEnd(evt: SortableEvent) {
  const pre = preDragBucketOrder;
  preDragBucketOrder = null;

  if (filtersActive.value) {
    return;
  }
  const fromKey = (evt.from as HTMLElement).dataset.bucketKey;
  const toKey = (evt.to as HTMLElement).dataset.bucketKey;
  const movedId = (evt.item as HTMLElement).dataset.connectId;
  if (!fromKey || !toKey || !movedId) {
    rebuildBucketOrder();
    await nextTick();
    initBucketSortables();
    return;
  }

  if (
    fromKey === toKey &&
    evt.oldIndex !== undefined &&
    evt.newIndex !== undefined &&
    evt.oldIndex === evt.newIndex
  ) {
    rebuildBucketOrder();
    await nextTick();
    initBucketSortables();
    return;
  }

  const keys = bucketKeysOrdered.value;
  const newBuckets: Record<string, string[]> = {};
  for (const key of keys) {
    const el = bucketListEls[key];
    newBuckets[key] = el ? readConnectIdsFromListEl(el) : [...(bucketOrder.value[key] ?? [])];
  }

  const selectedSet = new Set(getSelectedConnectIds());
  const multi =
    pre &&
    selectedSet.size > 1 &&
    selectedSet.has(movedId) &&
    [...selectedSet].every((id) => filteredConnects.value.some((c) => c.id === id));

  if (multi) {
    const domTo = readConnectIdsFromListEl(evt.to as HTMLElement);
    const insertAt =
      evt.newIndex !== undefined && evt.newIndex >= 0
        ? evt.newIndex
        : domTo.indexOf(movedId);
    if (insertAt < 0) {
      rebuildBucketOrder();
      await nextTick();
      initBucketSortables();
      return;
    }
    const merged = mergeMultiDragIntoBuckets(pre, selectedSet, toKey, insertAt);
    try {
      if (fromKey !== toKey) {
        const block = orderedSelectedIdsFromPre(pre, selectedSet);
        await Promise.all(
          block.map(async (id) => {
            const c = connects.value.find((x) => x.id === id);
            if (!c) {
              throw new Error('missing');
            }
            const nextNames = computeGroupNamesForBucket(c, toKey);
            await $fetch(`${config.public.apiBaseUrl}/connects/${id}/groups`, {
              method: 'PATCH',
              body: { groupNames: nextNames },
            });
          }),
        );
        toast.add({
          title: `Перенесено коннектов: ${selectedSet.size}`,
          color: 'success',
        });
      }
      clearConnectSortModeForBuckets(fromKey, toKey);
      bucketOrder.value = merged;
      await persistGlobalOrderFromBuckets(fromKey === toKey);
    } catch (err: unknown) {
      toast.add({
        title: fetchErrorMessage(err, 'Не удалось перенести коннект(ы)'),
        color: 'error',
      });
      await loadConnects();
      rebuildBucketOrder();
      await nextTick();
      initBucketSortables();
    }
    return;
  }

  if (fromKey !== toKey) {
    const c = connects.value.find((x) => x.id === movedId);
    if (!c) {
      await loadConnects();
      return;
    }
    const nextNames = computeGroupNamesForBucket(c, toKey);
    try {
      await $fetch(`${config.public.apiBaseUrl}/connects/${movedId}/groups`, {
        method: 'PATCH',
        body: { groupNames: nextNames },
      });
      toast.add({ title: 'Коннект перенесён', color: 'success' });
    } catch (err: unknown) {
      toast.add({
        title: fetchErrorMessage(err, 'Не удалось перенести коннект'),
        color: 'error',
      });
      await loadConnects();
      await nextTick();
      initBucketSortables();
      return;
    }
    clearConnectSortModeForBuckets(fromKey, toKey);
    bucketOrder.value = newBuckets;
    await persistGlobalOrderFromBuckets(false);
    return;
  }

  clearConnectSortModeForBuckets(fromKey);
  bucketOrder.value = newBuckets;
  await persistGlobalOrderFromBuckets(true);
}

async function persistGlobalOrderFromBuckets(showToast: boolean) {
  const keys = bucketKeysOrdered.value;
  const ordered: string[] = [];
  for (const k of keys) {
    ordered.push(...(bucketOrder.value[k] ?? []));
  }
  const allIds = new Set(connects.value.map((c) => c.id));
  if (ordered.length !== allIds.size) {
    const inOrdered = new Set(ordered);
    const rest = connects.value
      .filter((c) => !inOrdered.has(c.id))
      .sort(compareConnectsForBucket);
    ordered.push(...rest.map((c) => c.id));
  }
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const id of ordered) {
    if (!seen.has(id)) {
      seen.add(id);
      uniq.push(id);
    }
  }
  try {
    await $fetch(`${config.public.apiBaseUrl}/connects/reorder`, {
      method: 'PATCH',
      body: { ids: uniq },
    });
    if (showToast) {
      toast.add({ title: 'Порядок сохранён', color: 'success' });
    }
    await loadConnects();
    rebuildBucketOrder();
    await nextTick();
    await nextTick();
    initBucketSortables();
  } catch {
    toast.add({ title: 'Не удалось сохранить порядок', color: 'error' });
    await loadConnects();
    rebuildBucketOrder();
    await nextTick();
    initBucketSortables();
  }
}

const allFilteredSelected = computed(() => {
  const list = filteredConnects.value;
  if (!list.length) {
    return false;
  }
  return list.every((c) => rowSelection.value[c.id]);
});

const someFilteredSelected = computed(() =>
  filteredConnects.value.some((c) => rowSelection.value[c.id]),
);

function toggleSelectAllFiltered(value: boolean) {
  const next = { ...rowSelection.value };
  for (const c of filteredConnects.value) {
    next[c.id] = value;
  }
  rowSelection.value = next;
}

/** Только id, видимые в колонке сейчас (учёт фильтров и поиска). */
function visibleIdsInBucket(bucketKey: string): string[] {
  return [...(bucketOrder.value[bucketKey] ?? [])];
}

function someVisibleInBucketSelected(bucketKey: string): boolean {
  const ids = visibleIdsInBucket(bucketKey);
  return ids.some((id) => rowSelection.value[id]);
}

function toggleSelectAllInBucket(bucketKey: string, value: boolean) {
  const ids = visibleIdsInBucket(bucketKey);
  if (ids.length === 0) {
    return;
  }
  const next = { ...rowSelection.value };
  for (const id of ids) {
    next[id] = value;
  }
  rowSelection.value = next;
}

function toggleRowSelect(id: string, value: boolean) {
  rowSelection.value = { ...rowSelection.value, [id]: value };
}

watch(
  () => [
    filteredConnects.value.map((c) => c.id).join(),
    bucketKeysOrdered.value.join(),
    groups.value.length,
  ],
  () => {
    rebuildBucketOrder();
  },
  { flush: 'post' },
);

watch(
  () => ({
    bo: bucketOrder.value,
    bk: bucketKeysOrdered.value.join(),
    fa: filtersActive.value,
    ld: loading.value,
  }),
  async () => {
    await nextTick();
    await nextTick();
    destroyBucketSortables();
    if (filtersActive.value || loading.value) {
      return;
    }
    initBucketSortables();
  },
);

onMounted(() => {
  loadConnects();
  loadGroups();
});

onBeforeUnmount(() => {
  destroyBucketSortables();
});

async function loadConnects() {
  loading.value = true;
  try {
    connects.value = await $fetch<ConnectRow[]>(`${config.public.apiBaseUrl}/connects`);
  } catch {
    toast.add({ title: 'Не удалось загрузить коннекты', color: 'error' });
  } finally {
    loading.value = false;
  }
}

async function toggleStatus(id: string) {
  try {
    await $fetch(`${config.public.apiBaseUrl}/connects/${id}/toggle-status`, {
      method: 'PATCH',
    });
    toast.add({ title: 'Статус изменен', color: 'success' });
    await loadConnects();
  } catch {
    toast.add({ title: 'Не удалось изменить статус', color: 'error' });
  }
}

async function removeConnect(id: string) {
  try {
    await $fetch(`${config.public.apiBaseUrl}/connects/${id}`, {
      method: 'DELETE',
    });
    toast.add({ title: 'Коннект удален', color: 'success' });
    await loadConnects();
  } catch {
    toast.add({ title: 'Не удалось удалить коннект', color: 'error' });
  }
}

function askRemoveConnect(id: string) {
  deleteConnectId.value = id;
  isDeleteConfirmOpen.value = true;
}

async function confirmRemoveConnect() {
  if (!deleteConnectId.value) {
    return;
  }
  await removeConnect(deleteConnectId.value);
  isDeleteConfirmOpen.value = false;
  deleteConnectId.value = null;
}

async function copyConnectShareLink(id: string) {
  const c = connectById(id);
  const line = c?.raw?.trim() ?? '';
  if (!line) {
    toast.add({ title: 'Нет строки подключения', color: 'warning' });
    return;
  }
  try {
    await navigator.clipboard.writeText(line);
    toast.add({ title: 'Ссылка скопирована в буфер', color: 'success' });
  } catch {
    toast.add({ title: 'Не удалось скопировать', color: 'error' });
  }
}

async function loadGroups() {
  try {
    groups.value = await $fetch<GroupItem[]>(`${config.public.apiBaseUrl}/groups`);
  } catch {
    toast.add({ title: 'Не удалось загрузить группы', color: 'error' });
  }
}

function getConnectGroups(id: string) {
  return connects.value.find(item => item.id === id)?.groupNames ?? [];
}

function openBindGroups(id: string) {
  if (groups.value.length === 0) {
    toast.add({ title: 'Сначала создайте группы', color: 'error' });
    return;
  }
  selectedGroupConnectId.value = id;
  selectedGroupNames.value = [...getConnectGroups(id)];
  isGroupModalOpen.value = true;
}

function openEditName(connect: ConnectRow) {
  selectedNameConnectId.value = connect.id;
  editNameValue.value = connect.name;
  isNameModalOpen.value = true;
}

async function saveConnectName() {
  const name = editNameValue.value.trim();
  if (!selectedNameConnectId.value || !name) {
    toast.add({ title: 'Введите название', color: 'error' });
    return;
  }

  try {
    await $fetch(`${config.public.apiBaseUrl}/connects/${selectedNameConnectId.value}/name`, {
      method: 'PATCH',
      body: { name },
    });
    toast.add({ title: 'Название обновлено', color: 'success' });
    isNameModalOpen.value = false;
    await loadConnects();
  } catch {
    toast.add({ title: 'Не удалось обновить название', color: 'error' });
  }
}

async function saveConnectGroups() {
  if (!selectedGroupConnectId.value) {
    return;
  }
  if (countMainGroupsInNames(selectedGroupNames.value) > 1) {
    toast.add({
      title: 'У коннекта может быть не больше одной главной группы',
      color: 'error',
    });
    return;
  }
  try {
    await $fetch(`${config.public.apiBaseUrl}/connects/${selectedGroupConnectId.value}/groups`, {
      method: 'PATCH',
      body: {
        groupNames: selectedGroupNames.value
      }
    });
    isGroupModalOpen.value = false;
    toast.add({ title: 'Группы для коннекта обновлены', color: 'success' });
    await loadConnects();
  } catch (err: unknown) {
    toast.add({
      title: fetchErrorMessage(err, 'Не удалось обновить группы коннекта'),
      color: 'error',
    });
  }
}

function getSelectedConnectIds(): string[] {
  return Object.entries(rowSelection.value)
    .filter(([, selected]) => selected)
    .map(([id]) => id);
}

function clearRowSelection() {
  rowSelection.value = {};
}

async function bulkAddGroupsToSelection() {
  const ids = getSelectedConnectIds();
  const toAdd = bulkGroupNames.value.filter(Boolean);
  if (!ids.length) {
    return;
  }
  if (!toAdd.length) {
    toast.add({ title: 'Выберите группы', color: 'warning' });
    return;
  }
  if (groups.value.length === 0) {
    toast.add({ title: 'Сначала создайте группы', color: 'error' });
    return;
  }

  const snapshots = new Map(ids.map((id) => [id, [...getConnectGroups(id)]] as const));
  for (const id of ids) {
    const current = snapshots.get(id)!;
    const next = [...new Set([...current, ...toAdd])];
    if (countMainGroupsInNames(next) > 1) {
      toast.add({
        title:
          'После добавления у одного из коннектов получилось бы две главные группы. Уберите лишнюю главную из выбора или у коннекта.',
        color: 'error',
      });
      return;
    }
  }
  bulkLoading.value = true;
  try {
    await Promise.all(
      ids.map(async (id) => {
        const current = snapshots.get(id)!;
        const next = [...new Set([...current, ...toAdd])];
        await $fetch(`${config.public.apiBaseUrl}/connects/${id}/groups`, {
          method: 'PATCH',
          body: { groupNames: next }
        });
      })
    );
    toast.add({ title: 'Группы добавлены к выбранным коннектам', color: 'success' });
    bulkGroupNames.value = [];
    clearRowSelection();
    await loadConnects();
  } catch (err: unknown) {
    toast.add({
      title: fetchErrorMessage(err, 'Не удалось добавить группы'),
      color: 'error',
    });
  } finally {
    bulkLoading.value = false;
  }
}

async function bulkRemoveGroupsFromSelection() {
  const ids = getSelectedConnectIds();
  const toRemove = new Set(bulkGroupNames.value.filter(Boolean));
  if (!ids.length) {
    return;
  }
  if (!toRemove.size) {
    toast.add({ title: 'Выберите группы для удаления', color: 'warning' });
    return;
  }

  const snapshots = new Map(ids.map((id) => [id, [...getConnectGroups(id)]] as const));
  bulkLoading.value = true;
  try {
    await Promise.all(
      ids.map(async (id) => {
        const current = snapshots.get(id)!;
        const next = current.filter((g) => !toRemove.has(g));
        await $fetch(`${config.public.apiBaseUrl}/connects/${id}/groups`, {
          method: 'PATCH',
          body: { groupNames: next }
        });
      })
    );
    toast.add({ title: 'Группы убраны у выбранных коннектов', color: 'success' });
    bulkGroupNames.value = [];
    clearRowSelection();
    await loadConnects();
  } catch {
    toast.add({ title: 'Не удалось убрать группы', color: 'error' });
  } finally {
    bulkLoading.value = false;
  }
}

</script>

<template>
  <div class="cosmic-app space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="cosmic-h2">
        Коннекты
      </h2>
      <UButton
        color="neutral"
        variant="soft"
        icon="i-lucide-refresh-cw"
        :loading="loading"
        @click="loadConnects"
      >
        Обновить
      </UButton>
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="space-y-3 border-b border-default p-4">
        <p class="text-xs font-semibold text-highlighted">
          Фильтры
        </p>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <UFormField label="Подписка">
            <USelectMenu
              v-model="filterSubscriptionId"
              :items="subscriptionFilterItems"
              value-key="id"
              label-key="label"
              placeholder="Все подписки"
              class="w-full"
              clear
            />
          </UFormField>
          <UFormField label="Статус">
            <USelectMenu
              v-model="filterStatus"
              :items="statusFilterItems"
              value-key="id"
              label-key="label"
              placeholder="Любой"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Группа">
            <USelectMenu
              v-model="filterGroupName"
              :items="groupFilterItems"
              value-key="id"
              label-key="label"
              placeholder="Любая группа"
              class="w-full"
              clear
            />
          </UFormField>
          <UFormField
            label="Поиск по названию"
            description="Кастомное и исходное имя, подстрока, без учёта регистра; по всем колонкам"
            class="sm:col-span-2 lg:col-span-3"
          >
            <UInput
              v-model="connectSearchQuery"
              class="w-full"
              placeholder="Например: youtube или NL"
              icon="i-lucide-search"
              clear
            />
          </UFormField>
        </div>
        <div
          v-if="!loading && filteredConnects.length > 0"
          class="flex flex-wrap items-center gap-3 border-t border-default pt-3"
        >
          <UCheckbox
            :model-value="
              allFilteredSelected
                ? true
                : someFilteredSelected
                  ? 'indeterminate'
                  : false
            "
            label="Выбрать всех по фильтру"
            @update:model-value="
              (v) => {
                if (typeof v === 'boolean') {
                  toggleSelectAllFiltered(v)
                }
              }
            "
          />
        </div>
        <p v-if="filtersActive" class="text-xs text-muted">
          Перетаскивание между колонками и смена порядка отключены, пока включены фильтры или поиск.
        </p>
        <p v-else class="text-xs text-muted">
          Коннекты сгруппированы по главным группам. Без главной группы — колонка «Без группы». Тяните за
          <span class="font-mono">⋮⋮</span>
          за любую выбранную карточку — все отмеченные чекбоксом перенесутся в колонку и позицию, куда отпустите.
        </p>
      </div>

      <div
        v-if="selectedConnectsCount > 0"
        class="flex flex-col gap-3 border-b border-default p-4 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <p class="text-sm text-muted sm:mr-auto">
          Выбрано коннектов: <span class="font-medium text-highlighted">{{ selectedConnectsCount }}</span>
        </p>
        <UFormField label="Группы" class="w-full min-w-0 sm:max-w-md sm:flex-1">
          <USelectMenu
            v-model="bulkGroupNames"
            :items="groups.map((group) => group.name)"
            multiple
            class="w-full"
            placeholder="Выберите группы"
          />
        </UFormField>
        <div class="flex flex-wrap gap-2">
          <UButton
            size="sm"
            :loading="bulkLoading"
            :disabled="!bulkGroupNames.length"
            @click="bulkAddGroupsToSelection"
          >
            Добавить группы
          </UButton>
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            :loading="bulkLoading"
            :disabled="!bulkGroupNames.length"
            @click="bulkRemoveGroupsFromSelection"
          >
            Убрать группы
          </UButton>
          <UButton
            size="sm"
            color="neutral"
            variant="ghost"
            :disabled="bulkLoading"
            @click="clearRowSelection"
          >
            Снять выбор
          </UButton>
        </div>
      </div>

      <div v-if="loading && connects.length === 0" class="flex justify-center py-16">
        <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-muted" />
      </div>
      <div
        v-else-if="filteredConnects.length === 0"
        class="px-4 py-12 text-center text-sm text-muted"
      >
        {{ tableEmptyText }}
      </div>
      <div
        v-else
        class="connect-bucket-board flex flex-col gap-5 p-4 xl:flex-row xl:items-start xl:gap-4 xl:overflow-x-auto xl:pb-3"
      >
        <section
          v-for="bucketKey in bucketKeysOrdered"
          :key="bucketKey"
          class="connect-bucket-column w-full min-w-0 flex-shrink-0 xl:w-[min(100%,300px)]"
        >
          <div class="mb-2 space-y-2 border-b border-default pb-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-sm font-semibold text-highlighted min-w-0">
                {{ bucketColumnTitle(bucketKey) }}
              </h3>
              <div class="flex flex-shrink-0 flex-wrap items-center gap-1">
                <UTooltip
                  text="Выбрать всех в этой колонке (только карточки, видимые сейчас — с учётом фильтров и поиска)"
                >
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-check-square"
                    :disabled="(bucketOrder[bucketKey] ?? []).length === 0"
                    aria-label="Выбрать всех в колонке"
                    @click="toggleSelectAllInBucket(bucketKey, true)"
                  />
                </UTooltip>
                <UTooltip text="Снять выбор только с видимых в этой колонке">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-square-minus"
                    :disabled="!someVisibleInBucketSelected(bucketKey)"
                    aria-label="Снять выбор в колонке"
                    @click="toggleSelectAllInBucket(bucketKey, false)"
                  />
                </UTooltip>
                <UBadge
                  v-if="bucketKey !== NO_MAIN_BUCKET"
                  color="primary"
                  variant="subtle"
                  size="xs"
                >
                  Главная
                </UBadge>
                <UBadge v-else color="warning" variant="subtle" size="xs">
                  Нет главной
                </UBadge>
              </div>
            </div>
            <UFormField
              v-if="!filtersActive"
              label="Сортировка"
              class="w-full"
            >
              <USelectMenu
                :model-value="getBucketConnectSortMode(bucketKey)"
                :items="connectBucketSortMenuItems"
                value-key="id"
                label-key="label"
                size="sm"
                class="w-full"
                placeholder="Как в панели"
                @update:model-value="(v: unknown) => onConnectBucketSortPick(bucketKey, v)"
              />
            </UFormField>
            <p
              v-else
              class="text-[0.7rem] leading-snug text-muted"
            >
              Сортировка колонки отключена при активных фильтрах
            </p>
          </div>
          <div
            :ref="(el) => bindBucketListEl(bucketKey, el)"
            class="connect-bucket-list min-h-[100px] rounded-lg border border-default p-2"
            :class="filtersActive ? 'opacity-80' : ''"
            :data-bucket-key="bucketKey"
          >
            <div
              v-for="cid in bucketOrder[bucketKey] ?? []"
              :key="cid"
              data-connect-row
              :data-connect-id="cid"
              class="connect-bucket-card mb-2 rounded-md border border-default bg-elevated/40 p-2.5 last:mb-0"
            >
              <template v-if="connectById(cid)">
                <div class="flex items-start gap-2">
                  <div
                    class="connect-bucket-drag-handle mt-0.5 inline-flex shrink-0 cursor-grab text-muted active:cursor-grabbing"
                    :class="filtersActive ? 'pointer-events-none opacity-40' : ''"
                  >
                    <UIcon name="i-lucide-grip-vertical" class="size-4" />
                  </div>
                  <div
                    class="connect-bucket-card-body min-w-0 flex-1 space-y-2"
                    @pointerdown.stop
                  >
                    <div class="flex items-start justify-between gap-2">
                      <UCheckbox
                        :model-value="!!rowSelection[cid]"
                        @update:model-value="(v) => toggleRowSelect(cid, !!v)"
                      />
                      <div class="flex shrink-0 flex-wrap justify-end gap-0.5">
                        <UTooltip
                          :text="
                            (connectById(cid)?.raw ?? '').trim()
                              ? 'Скопировать строку подключения (vless и др.)'
                              : 'Строка подключения недоступна'
                          "
                        >
                          <UButton
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            icon="i-lucide-copy"
                            :disabled="!(connectById(cid)?.raw ?? '').trim()"
                            aria-label="Скопировать ссылку подключения"
                            @click="copyConnectShareLink(cid)"
                          />
                        </UTooltip>
                        <UTooltip text="Привязать к группам">
                          <UButton
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            icon="i-lucide-users-round"
                            @click="openBindGroups(cid)"
                          />
                        </UTooltip>
                        <UTooltip text="Удалить коннект">
                          <UButton
                            size="xs"
                            color="error"
                            variant="ghost"
                            icon="i-lucide-trash"
                            @click="askRemoveConnect(cid)"
                          />
                        </UTooltip>
                      </div>
                    </div>
                    <p class="text-xs text-muted">
                      {{ connectById(cid)!.subscription.title }}
                    </p>
                    <p class="truncate text-xs text-muted" :title="connectById(cid)!.originalName">
                      {{ connectById(cid)!.originalName }}
                    </p>
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      class="h-auto min-h-0 px-0 py-0 font-medium"
                      @click="openEditName(connectById(cid)!)"
                    >
                      {{ connectById(cid)!.name }}
                    </UButton>
                    <div class="flex flex-wrap items-center gap-1.5">
                      <UTooltip
                        :text="
                          connectById(cid)!.status === 'ACTIVE'
                            ? 'Отключить коннект'
                            : 'Включить коннект'
                        "
                      >
                        <UButton
                          size="xs"
                          color="neutral"
                          variant="soft"
                          :icon="
                            connectById(cid)!.status === 'ACTIVE'
                              ? 'i-lucide-eye'
                              : 'i-lucide-eye-off'
                          "
                          @click="toggleStatus(cid)"
                        />
                      </UTooltip>
                      <UBadge size="xs" variant="subtle" color="neutral">
                        {{ connectById(cid)!.protocol.toUpperCase() }}
                      </UBadge>
                    </div>
                    <div class="flex flex-wrap gap-1">
                      <UBadge
                        v-for="group in getConnectGroups(cid)"
                        :key="`${cid}-${group}`"
                        :color="
                          isUngroupedGroupLabel(group)
                            ? 'warning'
                            : isMainGroupLabel(group)
                              ? 'primary'
                              : 'neutral'
                        "
                        :variant="isUngroupedGroupLabel(group) ? 'solid' : 'subtle'"
                        size="sm"
                        :class="
                          isUngroupedGroupLabel(group)
                            ? 'connects-ungrouped-badge font-semibold tracking-wide'
                            : ''
                        "
                      >
                        {{ group }}
                      </UBadge>
                      <span
                        v-if="getConnectGroups(cid).length === 0"
                        class="text-xs text-muted"
                      >Нет групп</span>
                    </div>
                    <p class="text-[0.65rem] text-muted tabular-nums">
                      {{ new Date(connectById(cid)!.createdAt).toLocaleString('ru-RU') }}
                    </p>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </section>
      </div>
    </UCard>

    <UModal v-model:open="isGroupModalOpen" title="Привязать коннект к группам">
      <template #body>
        <UFormField
          label="Группы"
          description="Группы с меткой «главная» на странице «Группы»: у коннекта не больше одной такой одновременно."
        >
          <USelectMenu
            v-model="selectedGroupNames"
            :items="groups.map((group) => group.name)"
            multiple
            class="w-full"
            placeholder="Выберите группы"
          />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="isGroupModalOpen = false">
            Отмена
          </UButton>
          <UButton @click="saveConnectGroups">
            Сохранить
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="isNameModalOpen" title="Редактировать название">
      <template #body>
        <UFormField label="Кастомное название" required>
          <UInput v-model="editNameValue" class="w-full" placeholder="Введите название" />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="isNameModalOpen = false">
            Отмена
          </UButton>
          <UButton @click="saveConnectName">
            Сохранить
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="isDeleteConfirmOpen" title="Подтверждение удаления">
      <template #body>
        <p>Вы действительно хотите удалить этот коннект?</p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="isDeleteConfirmOpen = false">
            Отмена
          </UButton>
          <UButton color="error" @click="confirmRemoveConnect">
            Да, удалить
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.connect-bucket-list :deep(.sortable-ghost) {
  opacity: 0.45;
}

.connect-bucket-list :deep(.sortable-drag) {
  opacity: 0.95;
}

/* «Без группы» — явный акцент в таблице коннектов */
.connects-ungrouped-badge {
  box-shadow:
    0 0 0 2px rgba(251, 191, 36, 0.65),
    0 0 18px rgba(245, 158, 11, 0.45);
}

@media (prefers-reduced-motion: no-preference) {
  .connects-ungrouped-badge {
    animation: connects-ungrouped-glow 2.4s ease-in-out infinite;
  }
}

@keyframes connects-ungrouped-glow {
  0%,
  100% {
    box-shadow:
      0 0 0 2px rgba(251, 191, 36, 0.55),
      0 0 14px rgba(245, 158, 11, 0.35);
  }
  50% {
    box-shadow:
      0 0 0 2px rgba(253, 224, 71, 0.85),
      0 0 22px rgba(251, 191, 36, 0.55);
  }
}
</style>
