/*
 * TAR Patch 0.1.0 - Developer Hub source baseline export.
 * Server-side only. The client never supplies a filesystem path.
 */
import type { Request, Response } from 'express';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PATCH_VERSION = '0.1.0';
const AGENT_TARS_VERSION = '0.3.0';
const UPSTREAM_REPOSITORY = 'https://github.com/bytedance/UI-TARS-desktop.git';
const UPSTREAM_COMMIT = 'c2ad42e3eb9b27830db41a3e6f51ca7179d9b168';
const DEFAULT_SOURCE_ROOT = '/var/www/TAR/source/agent-tars';
const MAX_ZIP_BYTES = 0xffffffff;
const MAX_ZIP_ENTRIES = 65000;

const EXCLUDED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'logs',
  'log',
  'screenshots',
  'recordings',
  'backups',
  'backup',
  '.cache',
  'cache',
  '.turbo',
  '.next',
  'dist',
  'build',
  'coverage',
  'tmp',
  'temp',
  '.tmp',
  '.pnpm-store',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.mdx', '.txt', '.yaml', '.yml',
  '.toml', '.ini', '.conf', '.config', '.css', '.scss', '.html', '.xml', '.sh', '.py', '.go', '.rs',
  '.java', '.kt', '.rb', '.php', '.sql', '.graphql', '.gql', '.properties', '.lock',
]);

const HIGH_CONFIDENCE_SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'private-key', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'slack-token', regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: 'openai-project-key', regex: /\bsk-proj-[A-Za-z0-9_-]{32,}\b/ },
];

type SourceFile = {
  rel: string;
  absolute: string;
  size: number;
  mtime: Date;
};

type ZipEntry = {
  name: string;
  crc: number;
  size: number;
  offset: number;
  dosTime: number;
  dosDate: number;
};

function shouldExcludeFile(rel: string): boolean {
  const normalized = rel.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const base = parts[parts.length - 1].toLowerCase();

  if (parts.some((part) => EXCLUDED_DIR_NAMES.has(part.toLowerCase()))) return true;
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (base.endsWith('.log')) return true;
  if (base === '.ds_store') return true;
  if (base === '.npmrc' || base === '.pypirc' || base === '.netrc') return true;
  if (base === 'id_rsa' || base === 'id_ed25519') return true;
  if (base.endsWith('.pem') || base.endsWith('.key') || base.endsWith('.p12') || base.endsWith('.pfx')) return true;
  return false;
}

async function resolveSourceRoot(): Promise<string> {
  // Server-side configuration only. No request parameter is accepted.
  const configured = process.env.TAR_SOURCE_ROOT || DEFAULT_SOURCE_ROOT;
  const root = await fs.realpath(configured);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error(`TAR source root is not a directory: ${root}`);
  return root;
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return String(stdout).trim();
}

async function collectSourceFiles(root: string): Promise<SourceFile[]> {
  const result: SourceFile[] = [];

  async function walk(absDir: string, relDir: string): Promise<void> {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (shouldExcludeFile(rel)) continue;
      const absolute = path.join(absDir, entry.name);

      if (entry.isSymbolicLink()) {
        // Never follow links outside the fixed TAR source root.
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolute, rel);
        continue;
      }
      if (!entry.isFile()) continue;

      const stat = await fs.stat(absolute);
      result.push({ rel: rel.replace(/\\/g, '/'), absolute, size: stat.size, mtime: stat.mtime });
    }
  }

  await walk(root, '');
  return result;
}

async function secretScan(files: SourceFile[]): Promise<Array<{ path: string; type: string }>> {
  const hits: Array<{ path: string; type: string }> = [];

  for (const file of files) {
    if (file.size === 0 || file.size > 2 * 1024 * 1024) continue;
    const ext = path.extname(file.rel).toLowerCase();
    const base = path.basename(file.rel).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext) && !['dockerfile', 'makefile'].includes(base)) continue;

    let text: string;
    try {
      text = await fs.readFile(file.absolute, 'utf8');
    } catch {
      continue;
    }

    for (const pattern of HIGH_CONFIDENCE_SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(text)) hits.push({ path: file.rel, type: pattern.name });
    }
  }

  return hits;
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = buildCrcTable();

function crcUpdate(crc: number, chunk: Buffer): number {
  let c = crc >>> 0;
  for (const byte of chunk) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

function toDosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

async function writeChunk(res: Response, chunk: Buffer): Promise<void> {
  if (!res.write(chunk)) await once(res, 'drain');
}

function localHeader(name: Buffer, dosTime: number, dosDate: number): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0808, 6); // data descriptor + UTF-8
  header.writeUInt16LE(0, 8); // STORE: source export favors reliability over compression
  header.writeUInt16LE(dosTime, 10);
  header.writeUInt16LE(dosDate, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(0, 18);
  header.writeUInt32LE(0, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function dataDescriptor(crc: number, size: number): Buffer {
  const d = Buffer.alloc(16);
  d.writeUInt32LE(0x08074b50, 0);
  d.writeUInt32LE(crc >>> 0, 4);
  d.writeUInt32LE(size >>> 0, 8);
  d.writeUInt32LE(size >>> 0, 12);
  return d;
}

function centralHeader(entry: ZipEntry, name: Buffer): Buffer {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(20, 6);
  h.writeUInt16LE(0x0808, 8);
  h.writeUInt16LE(0, 10);
  h.writeUInt16LE(entry.dosTime, 12);
  h.writeUInt16LE(entry.dosDate, 14);
  h.writeUInt32LE(entry.crc >>> 0, 16);
  h.writeUInt32LE(entry.size >>> 0, 20);
  h.writeUInt32LE(entry.size >>> 0, 24);
  h.writeUInt16LE(name.length, 28);
  h.writeUInt16LE(0, 30);
  h.writeUInt16LE(0, 32);
  h.writeUInt16LE(0, 34);
  h.writeUInt16LE(0, 36);
  h.writeUInt32LE(0, 38);
  h.writeUInt32LE(entry.offset >>> 0, 42);
  return h;
}

function endOfCentralDirectory(count: number, centralSize: number, centralOffset: number): Buffer {
  const h = Buffer.alloc(22);
  h.writeUInt32LE(0x06054b50, 0);
  h.writeUInt16LE(0, 4);
  h.writeUInt16LE(0, 6);
  h.writeUInt16LE(count, 8);
  h.writeUInt16LE(count, 10);
  h.writeUInt32LE(centralSize >>> 0, 12);
  h.writeUInt32LE(centralOffset >>> 0, 16);
  h.writeUInt16LE(0, 20);
  return h;
}

async function streamZip(
  res: Response,
  files: SourceFile[],
  manifest: Record<string, unknown>,
): Promise<void> {
  const entries: ZipEntry[] = [];
  let offset = 0;

  const write = async (buffer: Buffer) => {
    await writeChunk(res, buffer);
    offset += buffer.length;
  };

  async function writeVirtual(nameText: string, data: Buffer, mtime: Date): Promise<void> {
    const name = Buffer.from(nameText, 'utf8');
    const dt = toDosDateTime(mtime);
    const localOffset = offset;
    await write(localHeader(name, dt.time, dt.date));
    await write(name);
    let crc = 0xffffffff;
    crc = crcUpdate(crc, data);
    await write(data);
    crc = (crc ^ 0xffffffff) >>> 0;
    await write(dataDescriptor(crc, data.length));
    entries.push({ name: nameText, crc, size: data.length, offset: localOffset, dosTime: dt.time, dosDate: dt.date });
  }

  for (const file of files) {
    const name = Buffer.from(file.rel, 'utf8');
    const dt = toDosDateTime(file.mtime);
    const localOffset = offset;
    await write(localHeader(name, dt.time, dt.date));
    await write(name);

    let crc = 0xffffffff;
    let size = 0;
    const stream = createReadStream(file.absolute);
    for await (const raw of stream) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      crc = crcUpdate(crc, chunk);
      size += chunk.length;
      await write(chunk);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    await write(dataDescriptor(crc, size));
    entries.push({ name: file.rel, crc, size, offset: localOffset, dosTime: dt.time, dosDate: dt.date });
  }

  await writeVirtual('BASELINE_MANIFEST.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'), new Date());

  const centralOffset = offset;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    await write(centralHeader(entry, name));
    await write(name);
  }
  const centralSize = offset - centralOffset;
  await write(endOfCentralDirectory(entries.length, centralSize, centralOffset));
  res.end();
}

async function buildInfo(root: string, files?: SourceFile[]) {
  const [currentCommit, status] = await Promise.all([
    git(root, ['rev-parse', 'HEAD']),
    git(root, ['status', '--porcelain=v1', '--untracked-files=normal']),
  ]);
  const sourceFiles = files || (await collectSourceFiles(root));

  return {
    patchVersion: PATCH_VERSION,
    agentTarsVersion: AGENT_TARS_VERSION,
    upstreamRepository: UPSTREAM_REPOSITORY,
    upstreamCommit: UPSTREAM_COMMIT,
    currentCommit,
    workingTreeDirty: status.length > 0,
    sourceFileCount: sourceFiles.length,
  };
}

export async function getSourceInfo(_req: Request, res: Response) {
  try {
    const root = await resolveSourceRoot();
    const info = await buildInfo(root);
    res.status(200).json(info);
  } catch (error) {
    console.error('[TAR Developer Hub] Failed to get source info:', error);
    res.status(500).json({ error: 'Failed to inspect TAR source baseline' });
  }
}

export async function downloadSourceCode(_req: Request, res: Response) {
  try {
    const root = await resolveSourceRoot();
    const files = await collectSourceFiles(root);

    if (files.length + 1 > MAX_ZIP_ENTRIES) {
      return res.status(413).json({ error: 'Source tree has too many files for a safe ZIP32 export' });
    }

    const estimatedBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (estimatedBytes >= MAX_ZIP_BYTES - 64 * 1024 * 1024) {
      return res.status(413).json({ error: 'Source tree is too large for a safe ZIP32 export' });
    }

    const secretHits = await secretScan(files);
    if (secretHits.length > 0) {
      console.error('[TAR Developer Hub] Source export blocked by secret scan:', secretHits.map((hit) => ({ path: hit.path, type: hit.type })));
      return res.status(409).json({
        error: 'Source export blocked by server-side secret scan',
        findings: secretHits.map((hit) => ({ path: hit.path, type: hit.type })),
      });
    }

    const info = await buildInfo(root, files);
    const manifest = {
      upstreamRepository: UPSTREAM_REPOSITORY,
      upstreamCommit: UPSTREAM_COMMIT,
      agentTarsVersion: AGENT_TARS_VERSION,
      tarPatchVersion: PATCH_VERSION,
      generatedAt: new Date().toISOString(),
      currentCommit: info.currentCommit,
      sanitizedConfigurationMetadata: {
        archiveMode: 'current-working-tree',
        workingTreeDirty: info.workingTreeDirty,
        sourceFileCount: files.length,
        secretScan: 'PASS',
        excluded: [
          '.env', '.env.*', '.git', 'node_modules', 'logs', 'screenshots', 'recordings',
          'backups', 'cache/build cache', 'build artifacts', 'temporary files', 'private key files',
        ],
      },
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `TAR-source-${AGENT_TARS_VERSION}-${String(info.currentCommit).slice(0, 7)}-${timestamp}.zip`;

    res.status(200);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-TAR-Secret-Scan', 'PASS');
    res.setHeader('X-TAR-Patch-Version', PATCH_VERSION);
    res.setHeader('X-TAR-Upstream-Commit', UPSTREAM_COMMIT);

    await streamZip(res, files, manifest);
  } catch (error) {
    console.error('[TAR Developer Hub] Source download failed:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create TAR source baseline ZIP' });
    } else {
      res.destroy(error instanceof Error ? error : new Error('Source export failed'));
    }
  }
}
