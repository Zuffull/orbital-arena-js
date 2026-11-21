function number(params: URLSearchParams, key: string, max: number) {
  const value = Number(params.get(key));
  return Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : 0;
}

export function createLink(url = "/ws") {
  const params = new URL(url, "http://localhost").searchParams;
  const delay = number(params, "lag", 1000) / 2;
  const spread = number(params, "jitter", 400) / 2;
  const loss = number(params, "loss", 30) / 100;
  const timers = new Set<NodeJS.Timeout>();

  return {
    schedule(action: () => void, drop = true) {
      if (drop && loss && Math.random() < loss) return;
      if (!delay && !spread) return action();
      const timer = setTimeout(() => {
        timers.delete(timer);
        action();
      }, Math.max(0, delay + spread * (2 * Math.random() - 1)));
      timers.add(timer);
    },
    close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
