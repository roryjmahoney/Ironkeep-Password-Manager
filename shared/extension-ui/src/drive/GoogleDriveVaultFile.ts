const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const VAULT_FILE_NAME = "ironkeep-vault.ikv";
const MAX_VAULT_BYTES = 64 * 1024 * 1024;

function blobBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export interface DriveTokenProvider {
  getAccessToken(interactive: boolean): Promise<string>;
}

export interface RemoteVaultFile {
  fileId: string;
  etag: string;
  modifiedTime: string;
  md5Checksum: string;
  bytes: Uint8Array;
}

export class DriveConflictError extends Error {
  constructor(message = "Google Drive vault changed since it was downloaded") {
    super(message);
    this.name = "DriveConflictError";
  }
}

interface DriveListResponse {
  files?: Array<{ id: string; modifiedTime: string; md5Checksum?: string }>;
}

interface DriveMetadata {
  id: string;
  modifiedTime: string;
  md5Checksum?: string;
}

async function errorText(response: Response): Promise<string> {
  const text = await response.text();
  return text.slice(0, 512);
}

async function readBounded(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_VAULT_BYTES) {
    throw new RangeError("Remote vault exceeds the 64 MiB limit");
  }
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_VAULT_BYTES) throw new RangeError("Remote vault exceeds the 64 MiB limit");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export class GoogleDriveVaultFile {
  static readonly requiredScope = DRIVE_SCOPE;

  constructor(private readonly tokens: DriveTokenProvider) {}

  private async request(url: string, init: RequestInit = {}, interactive = false): Promise<Response> {
    const token = await this.tokens.getAccessToken(interactive);
    const response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    });
    if (!response.ok && response.status !== 412) {
      throw new Error(`Google Drive request failed (${response.status}): ${await errorText(response)}`);
    }
    return response;
  }

  async read(interactive = false): Promise<RemoteVaultFile | null> {
    const query = new URLSearchParams({
      spaces: "appDataFolder",
      q: `name = '${VAULT_FILE_NAME}' and trashed = false`,
      orderBy: "modifiedTime desc",
      pageSize: "10",
      fields: "files(id,modifiedTime,md5Checksum)",
    });
    const listResponse = await this.request(`https://www.googleapis.com/drive/v3/files?${query}`, {}, interactive);
    const list = await listResponse.json() as DriveListResponse;
    if (!list.files?.length) return null;
    if (list.files.length > 1) throw new DriveConflictError("Multiple Ironkeep vault files exist in Drive appDataFolder");
    const summary = list.files[0]!;
    const metadataResponse = await this.request(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(summary.id)}?fields=id,modifiedTime,md5Checksum`,
    );
    const metadata = await metadataResponse.json() as DriveMetadata;
    const contentResponse = await this.request(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(summary.id)}?alt=media`,
    );
    return {
      fileId: summary.id,
      etag: metadataResponse.headers.get("etag") ?? contentResponse.headers.get("etag") ?? "",
      modifiedTime: metadata.modifiedTime,
      md5Checksum: metadata.md5Checksum ?? "",
      bytes: await readBounded(contentResponse),
    };
  }

  async create(bytes: Uint8Array): Promise<{ fileId: string; etag: string }> {
    if (await this.read()) throw new DriveConflictError("An Ironkeep vault already exists in Drive");
    const boundary = `ironkeep_${crypto.randomUUID().replaceAll("-", "")}`;
    const metadata = JSON.stringify({ name: VAULT_FILE_NAME, parents: ["appDataFolder"], mimeType: "application/vnd.ironkeep.vault" });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      blobBytes(bytes),
      `\r\n--${boundary}--`,
    ]);
    const response = await this.request("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    const metadataResponse = await response.json() as { id: string };
    return { fileId: metadataResponse.id, etag: response.headers.get("etag") ?? "" };
  }

  async update(fileId: string, expectedEtag: string, bytes: Uint8Array): Promise<{ etag: string }> {
    if (!expectedEtag) throw new DriveConflictError("Missing Drive ETag; refusing an unconditional overwrite");
    const response = await this.request(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,modifiedTime,md5Checksum`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/octet-stream", "If-Match": expectedEtag },
        body: new Blob([blobBytes(bytes)], { type: "application/octet-stream" }),
      },
    );
    if (response.status === 412) throw new DriveConflictError();
    return { etag: response.headers.get("etag") ?? "" };
  }
}
