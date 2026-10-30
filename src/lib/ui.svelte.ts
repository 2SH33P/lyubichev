import type { Category, Entry, Todo } from './types';

export interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
}

interface ConfirmReq {
  title: string;
  message?: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  resolve: (v: boolean) => void;
}

interface PromptReq {
  title: string;
  message?: string;
  placeholder?: string;
  password?: boolean;
  value?: string;
  okText?: string;
  resolve: (v: string | null) => void;
}

class UIState {
  toasts = $state<ToastItem[]>([]);
  confirm = $state<ConfirmReq | null>(null);
  prompt = $state<PromptReq | null>(null);
  entry = $state<{ entry: Entry; isNew: boolean } | null>(null);
  todo = $state<{ todo: Todo; isNew: boolean } | null>(null);
  category = $state<{ category: Category; isNew: boolean } | null>(null);
  picker = $state<{ title: string; resolve: (id: string | null) => void } | null>(null);
  updateReady = $state<null | (() => void)>(null);
}

export const ui = new UIState();
let seq = 1;

export function toast(text: string, kind: ToastItem['kind'] = 'info', action?: ToastItem['action'], ms = 3200) {
  const id = seq++;
  ui.toasts = [...ui.toasts, { id, text, kind, action }];
  setTimeout(() => (ui.toasts = ui.toasts.filter((x) => x.id !== id)), action ? ms + 2500 : ms);
}

export function confirmDialog(o: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => (ui.confirm = { ...o, resolve }));
}

export function promptDialog(o: Omit<PromptReq, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => (ui.prompt = { ...o, resolve }));
}

export function pickCategory(title: string): Promise<string | null> {
  return new Promise((resolve) => (ui.picker = { title, resolve }));
}

export function editEntry(entry: Entry, isNew = false) {
  ui.entry = { entry: structuredClone($state.snapshot(entry) as Entry), isNew };
}
export function editTodo(todo: Todo, isNew = false) {
  ui.todo = { todo: structuredClone($state.snapshot(todo) as Todo), isNew };
}
export function editCategory(category: Category, isNew = false) {
  ui.category = { category: structuredClone($state.snapshot(category) as Category), isNew };
}

/** 把异常转成提示 */
export function report(e: unknown) {
  console.error(e);
  toast((e as Error)?.message || String(e), 'error');
}
