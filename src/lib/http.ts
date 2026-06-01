export interface HttpOptions {
  baseUrl: string;
  headers?: Record<string, string>;
}

export interface RequestOptions {
  method?: string;
  params?: Record<string, string>;
  body?: unknown;
  rawResponse?: boolean;
}

export class HttpClient {
  constructor(private opts: HttpOptions) {}

  async request<T = unknown>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const { method = "GET", params, body } = options;

    let url = `${this.opts.baseUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") {
          searchParams.set(key, value);
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = { ...this.opts.headers };
    const init: RequestInit = { method, headers };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);

    if (options.rawResponse) {
      return { status: res.status, ok: res.ok } as T;
    }

    if (res.status === 204) {
      return undefined as T;
    }

    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      const text = raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
      throw new Error(`HTTP ${res.status} ${method} ${path}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async get<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
    return this.request<T>(path, { params });
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body });
  }

  async delete(path: string): Promise<boolean> {
    const res = await this.request<{ status: number; ok: boolean }>(path, {
      method: "DELETE",
      rawResponse: true,
    });
    return res.ok;
  }
}
