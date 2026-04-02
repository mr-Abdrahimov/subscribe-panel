type SubscriptionItem = {
  id: string;
  title: string;
  url: string;
  createdAt: string;
};

const STORAGE_KEY = 'vpnSubscriptions';

export function useSubscriptions() {
  const items = useState<SubscriptionItem[]>('vpn-subscriptions', () => []);

  function load() {
    if (!import.meta.client) {
      return;
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      items.value = [];
      return;
    }

    try {
      const parsed = JSON.parse(raw) as SubscriptionItem[];
      items.value = Array.isArray(parsed)
        ? parsed.map((item) => ({
            ...item,
            title: item.title || 'Без названия',
          }))
        : [];
    } catch {
      items.value = [];
    }
  }

  function persist() {
    if (!import.meta.client) {
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.value));
  }

  function add(title: string, url: string) {
    items.value.unshift({
      id: crypto.randomUUID(),
      title,
      url,
      createdAt: new Date().toISOString()
    });
    persist();
  }

  function update(id: string, title: string, url: string) {
    const item = items.value.find(i => i.id === id);
    if (!item) {
      return;
    }
    item.title = title;
    item.url = url;
    persist();
  }

  function remove(id: string) {
    items.value = items.value.filter(i => i.id !== id);
    persist();
  }

  return {
    items,
    load,
    add,
    update,
    remove
  };
}

export type { SubscriptionItem };

