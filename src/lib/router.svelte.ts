export type Route = 'today' | 'todos' | 'entries' | 'stats' | 'plans' | 'reviews' | 'categories' | 'settings' | 'versions' | 'more';
const ROUTES: Route[] = ['today', 'todos', 'entries', 'stats', 'plans', 'reviews', 'categories', 'settings', 'versions', 'more'];

function parse(): { route: Route; query: URLSearchParams } {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const route = (ROUTES.includes(path as Route) ? path : 'today') as Route;
  return { route, query: new URLSearchParams(qs || '') };
}

let state = $state(parse());
if (typeof window !== 'undefined')
  window.addEventListener('hashchange', () => {
    const next = parse();
    const changed = next.route !== state.route;
    state = next;
    if (changed) window.scrollTo({ top: 0 });
  });

export const router = {
  get route() {
    return state.route;
  },
  get query() {
    return state.query;
  }
};

export function go(route: Route, query?: Record<string, string>) {
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  location.hash = `#/${route}${qs}`;
}
