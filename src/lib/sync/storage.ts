import { AwsClient } from 'aws4fetch';
import { sha256Hex } from '../codec';
import type { SyncConfig } from '../types';

export interface ObjectInfo {
  key: string;
  size: number;
  lastModified: string;
}

export interface ListResult {
  objects: ObjectInfo[];
  prefixes: string[];
  truncated: boolean;
  nextMarker: string | null;
}

export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  list(prefix: string, opts?: { delimiter?: string; marker?: string }): Promise<ListResult>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
  }
}

export async function listAll(s: ObjectStorage, prefix: string, marker?: string): Promise<ObjectInfo[]> {
  const out: ObjectInfo[] = [];
  let m = marker;
  for (let i = 0; i < 1000; i++) {
    const r = await s.list(prefix, { marker: m });
    out.push(...r.objects);
    if (!r.truncated) break;
    m = r.nextMarker ?? r.objects[r.objects.length - 1]?.key;
    if (!m) break;
  }
  return out;
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decodeXml(m[1]) : null;
};

/** 解析 ListObjects (v1) 的 XML 响应（S3 与腾讯云 COS 通用） */
export function parseListXml(xml: string): ListResult {
  const objects: ObjectInfo[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = tag(m[1], 'Key');
    if (key !== null) objects.push({ key, size: Number(tag(m[1], 'Size') || 0), lastModified: tag(m[1], 'LastModified') || '' });
  }
  const prefixes: string[] = [];
  for (const m of xml.matchAll(/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g)) {
    const p = tag(m[1], 'Prefix');
    if (p) prefixes.push(p);
  }
  return {
    objects,
    prefixes,
    truncated: tag(xml, 'IsTruncated') === 'true',
    nextMarker: tag(xml, 'NextMarker')
  };
}

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');

/** 兼容 S3 协议的对象存储（腾讯云 COS、AWS S3、Cloudflare R2、MinIO 等） */
export class S3Storage implements ObjectStorage {
  private client: AwsClient;
  private base: string;

  constructor(cfg: Pick<SyncConfig, 'provider' | 'bucket' | 'region' | 'endpoint' | 'pathStyle' | 'accessKeyId' | 'secretAccessKey'>) {
    this.client = new AwsClient({
      accessKeyId: cfg.accessKeyId.trim(),
      secretAccessKey: cfg.secretAccessKey.trim(),
      service: 's3',
      region: cfg.region.trim() || 'us-east-1',
      retries: 2
    });
    this.base = S3Storage.baseUrl(cfg);
  }

  static baseUrl(cfg: Pick<SyncConfig, 'provider' | 'bucket' | 'region' | 'endpoint' | 'pathStyle'>): string {
    const bucket = cfg.bucket.trim();
    if (cfg.provider === 'cos') return `https://${bucket}.cos.${cfg.region.trim()}.myqcloud.com`;
    const ep = cfg.endpoint.trim().replace(/\/+$/, '');
    if (cfg.pathStyle) return `${ep}/${bucket}`;
    const u = new URL(ep);
    return `${u.protocol}//${bucket}.${u.host}`;
  }

  private async req(method: string, path: string, body?: Uint8Array, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { ...headers, 'x-amz-content-sha256': await sha256Hex(body ?? new Uint8Array()) };
    let res: Response;
    try {
      const init: RequestInit = { method, body: body as BodyInit | undefined, headers: h };
      // 浏览器中禁用 HTTP 缓存，避免读到旧的 meta.json / 列表
      if (typeof window !== 'undefined') init.cache = 'no-store';
      res = await this.client.fetch(`${this.base}${path}`, init);
    } catch (e) {
      throw new StorageError(`Network/CORS error: ${(e as Error).message}`, 0, 'Network');
    }
    return res;
  }

  private async fail(res: Response): Promise<never> {
    const text = await res.text().catch(() => '');
    const code = tag(text, 'Code') || undefined;
    const msg = tag(text, 'Message') || res.statusText;
    throw new StorageError(`${res.status} ${code ?? ''} ${msg}`.trim(), res.status, code);
  }

  async put(key: string, body: Uint8Array, contentType = 'application/octet-stream') {
    const res = await this.req('PUT', `/${encodeKey(key)}`, body, { 'content-type': contentType });
    if (!res.ok) await this.fail(res);
  }

  async get(key: string) {
    const res = await this.req('GET', `/${encodeKey(key)}`);
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res);
    return new Uint8Array(await res.arrayBuffer());
  }

  async delete(key: string) {
    const res = await this.req('DELETE', `/${encodeKey(key)}`);
    if (!res.ok && res.status !== 404) await this.fail(res);
  }

  async list(prefix: string, opts: { delimiter?: string; marker?: string } = {}) {
    const q = new URLSearchParams({ prefix, 'max-keys': '1000' });
    if (opts.delimiter) q.set('delimiter', opts.delimiter);
    if (opts.marker) q.set('marker', opts.marker);
    const res = await this.req('GET', `/?${q.toString()}`);
    if (!res.ok) await this.fail(res);
    return parseListXml(await res.text());
  }
}

/** 内存实现，用于测试 */
export class MemoryStorage implements ObjectStorage {
  objects = new Map<string, Uint8Array>();
  pageSize = 1000;
  async put(key: string, body: Uint8Array) {
    this.objects.set(key, body.slice());
  }
  async get(key: string) {
    return this.objects.get(key)?.slice() ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async list(prefix: string, opts: { delimiter?: string; marker?: string } = {}) {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix) && (!opts.marker || k > opts.marker)).sort();
    const objects: ObjectInfo[] = [];
    const prefixes = new Set<string>();
    for (const k of keys) {
      if (opts.delimiter) {
        const rest = k.slice(prefix.length);
        const i = rest.indexOf(opts.delimiter);
        if (i >= 0) {
          prefixes.add(prefix + rest.slice(0, i + 1));
          continue;
        }
      }
      objects.push({ key: k, size: this.objects.get(k)!.length, lastModified: '' });
    }
    const page = objects.slice(0, this.pageSize);
    return { objects: page, prefixes: [...prefixes], truncated: objects.length > page.length, nextMarker: null };
  }
}
