import { computed, type Ref } from 'vue';

const TAB = '  ';

/**
 * Вставка отступа по Tab / снятие по Shift+Tab в textarea, проверка JSON по тексту.
 */
export function useJsonTextareaTab(jsonText: Ref<string>) {
  const parseError = computed(() => {
    const t = jsonText.value.trim();
    if (!t) return '';
    try {
      JSON.parse(t);
      return '';
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  });

  const isJsonValid = computed(() => {
    const t = jsonText.value.trim();
    if (!t) return false;
    try {
      JSON.parse(t);
      return true;
    } catch {
      return false;
    }
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const el = e.target as HTMLTextAreaElement;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const val = jsonText.value;

    if (start === end) {
      jsonText.value = val.slice(0, start) + TAB + val.slice(end);
      queueMicrotask(() => {
        el.selectionStart = el.selectionEnd = start + TAB.length;
      });
      return;
    }

    const before = val.slice(0, start);
    const selected = val.slice(start, end);
    const after = val.slice(end);
    const lines = selected.split('\n');

    if (e.shiftKey) {
      const next = lines
        .map((line) => {
          if (line.startsWith(TAB)) return line.slice(TAB.length);
          if (line.startsWith('\t')) return line.slice(1);
          return line;
        })
        .join('\n');
      jsonText.value = before + next + after;
      const delta = selected.length - next.length;
      queueMicrotask(() => {
        el.selectionStart = start;
        el.selectionEnd = end - delta;
      });
    } else {
      const next = lines.map((line) => TAB + line).join('\n');
      jsonText.value = before + next + after;
      const delta = next.length - selected.length;
      queueMicrotask(() => {
        el.selectionStart = start;
        el.selectionEnd = end + delta;
      });
    }
  }

  function parseJson(): unknown | null {
    const t = jsonText.value.trim();
    if (!t) return null;
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return null;
    }
  }

  return { parseError, isJsonValid, onKeydown, parseJson };
}
