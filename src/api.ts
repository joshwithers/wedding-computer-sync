/**
 * Wedding Computer vault API client.
 *
 * Uses Obsidian's requestUrl (not fetch) so requests work on mobile and
 * are exempt from CORS.
 */

import { requestUrl } from 'obsidian'

export type RemoteFile = { path: string; etag: string; size: number }

export type PutResult =
  | { ok: true; etag: string }
  | { ok: false; status: number; error: string; serverEtag?: string }

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function isListResponse(data: unknown): data is { vendor: string; files: RemoteFile[] } {
  if (data === null || typeof data !== 'object') return false
  const obj = data as { vendor?: unknown; files?: unknown }
  if (typeof obj.vendor !== 'string' || !Array.isArray(obj.files)) return false
  return obj.files.every(
    (f: unknown) =>
      f !== null &&
      typeof f === 'object' &&
      typeof (f as { path?: unknown }).path === 'string' &&
      typeof (f as { etag?: unknown }).etag === 'string'
  )
}

export class WeddingComputerClient {
  constructor(
    private baseUrl: string,
    private token: string
  ) {}

  private url(path: string): string {
    return this.baseUrl.replace(/\/+$/, '') + path
  }

  private fileUrl(serverPath: string): string {
    const encoded = serverPath.split('/').map(encodeURIComponent).join('/')
    return this.url('/vault/v1/file/' + encoded)
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, ...extra }
  }

  private static header(headers: Record<string, string>, name: string): string | undefined {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
    return key ? headers[key] : undefined
  }

  private static etagOf(headers: Record<string, string>): string | undefined {
    return WeddingComputerClient.header(headers, 'etag')?.replace(/^W\//, '').replace(/^"|"$/g, '')
  }

  private static errorOf(res: { text: string }, fallback: string): string {
    try {
      const parsed: unknown = JSON.parse(res.text)
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'error' in parsed &&
        typeof (parsed).error === 'string'
      ) {
        return (parsed as { error: string }).error
      }
    } catch {
      /* not json */
    }
    return fallback
  }

  async listFiles(): Promise<{ vendor: string; files: RemoteFile[] }> {
    const res = await requestUrl({
      url: this.url('/vault/v1/files'),
      headers: this.headers(),
      throw: false,
    })
    if (res.status !== 200) {
      throw new ApiError(res.status, WeddingComputerClient.errorOf(res, `List failed (${res.status})`))
    }
    const data: unknown = res.json
    if (!isListResponse(data)) {
      throw new ApiError(res.status, 'Unexpected response from the server')
    }
    return data
  }

  async getFile(serverPath: string): Promise<{ content: string; etag: string }> {
    const res = await requestUrl({
      url: this.fileUrl(serverPath),
      headers: this.headers(),
      throw: false,
    })
    if (res.status !== 200) {
      throw new ApiError(res.status, WeddingComputerClient.errorOf(res, `Read failed (${res.status})`))
    }
    return { content: res.text, etag: WeddingComputerClient.etagOf(res.headers) ?? '' }
  }

  /**
   * Write a file. Pass the etag we last saw to update, or omit it to
   * create. A 412 means the server has something we haven't seen —
   * the caller resolves the conflict.
   */
  async putFile(serverPath: string, content: string, baseEtag?: string): Promise<PutResult> {
    const precondition: Record<string, string> = baseEtag
      ? { 'If-Match': `"${baseEtag}"` }
      : { 'If-None-Match': '*' }

    const res = await requestUrl({
      url: this.fileUrl(serverPath),
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'text/markdown; charset=utf-8', ...precondition }),
      body: content,
      throw: false,
    })

    if (res.status === 200) {
      const body: unknown = res.json
      const bodyEtag =
        body !== null &&
        typeof body === 'object' &&
        'etag' in body &&
        typeof (body).etag === 'string'
          ? (body as { etag: string }).etag
          : undefined
      return { ok: true, etag: bodyEtag ?? WeddingComputerClient.etagOf(res.headers) ?? '' }
    }

    return {
      ok: false,
      status: res.status,
      error: WeddingComputerClient.errorOf(res, `Write failed (${res.status})`),
      serverEtag: WeddingComputerClient.etagOf(res.headers),
    }
  }
}
