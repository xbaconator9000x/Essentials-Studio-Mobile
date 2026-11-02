/**
 * Browser-only development transport. The Rust bridge is reached through
 * Vite's same-origin proxy; its ephemeral bearer token never enters JS.
 * No cross-origin requests, arbitrary remote backends or mock write success.
 */
export async function callBrowserBridge<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  endpoint: string,
  origin: string,
  request: typeof fetch = fetch,
): Promise<T> {
  const page = new URL(origin);
  if (!["127.0.0.1", "localhost"].includes(page.hostname)) {
    throw new Error("Browser project editing is only available on local development hosts");
  }
  const base = new URL(endpoint, page);
  if (base.origin !== page.origin || base.username || base.password) {
    throw new Error("Browser backend must use the same-origin development proxy");
  }
  const url = new URL("invoke", base);
  if (url.origin !== page.origin) {
    throw new Error("Browser backend URL escaped the development origin");
  }
  const response = await request(url.toString(), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Essentials-Client": "browser-dev",
    },
    body: JSON.stringify({ command, args: args ?? {} }),
  });
  let payload: { ok?: boolean; result?: T; error?: string };
  try {
    payload = await response.json() as typeof payload;
  } catch {
    throw new Error("Browser project backend did not return a JSON response");
  }
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.error || ("Browser project command " + command + " failed (HTTP " + response.status + ")"));
  }
  return payload.result as T;
}
