import { AwsClient } from 'aws4fetch'

// Cloudflare R2 over the S3 API. Keys are relative paths such as fit/<id>.zip. Errors carry only the status.
export class R2 {
  private c: AwsClient
  private base: string
  private f: typeof fetch
  constructor(o: { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string; fetch?: typeof fetch }) {
    this.c = new AwsClient({ accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey, service: 's3', region: 'auto' })
    this.base = `https://${o.accountId}.r2.cloudflarestorage.com/${o.bucket}`
    this.f = o.fetch ?? fetch
  }
  private async send(method: string, key: string, body?: Uint8Array) {
    const req = await this.c.sign(`${this.base}/${key}`, { method, body: body as BodyInit | undefined })
    return this.f(req)
  }
  async exists(key: string) {
    const r = await this.send('HEAD', key)
    if (r.status === 404) return false
    if (!r.ok) throw new Error(`r2 ${r.status}`)
    return true
  }
  async put(key: string, body: Uint8Array) {
    const r = await this.send('PUT', key, body)
    if (!r.ok) throw new Error(`r2 ${r.status}`)
  }
}
