import React, { useEffect, useState } from 'react';
import { FiCheckCircle, FiCode, FiDownload, FiRefreshCw, FiShield } from 'react-icons/fi';
import { API_BASE_URL } from '@/config/web-ui-config';

type SourceInfo = {
  patchVersion: string;
  agentTarsVersion: string;
  upstreamRepository: string;
  upstreamCommit: string;
  currentCommit: string;
  workingTreeDirty: boolean;
  sourceFileCount: number;
};

const DeveloperHub: React.FC = () => {
  const [info, setInfo] = useState<SourceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInfo = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/developer/source-info`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setInfo((await response.json()) as SourceInfo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load source information');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadInfo();
  }, []);

  const downloadUrl = `${API_BASE_URL}/api/v1/developer/source-download`;

  return (
    <main className="min-h-full px-6 py-8 lg:px-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-blue-200/70 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:border-blue-700/60 dark:bg-blue-950/40 dark:text-blue-200">
              <FiCode size={13} /> TAR Developer Hub
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-gray-950 dark:text-white">Developer Hub</h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-300">
              Controlled developer access for the TAR source baseline. Phase 1 exposes a sanitized source export only.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadInfo()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <FiRefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </header>

        <section className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm dark:border-gray-700/80 dark:bg-gray-900">
          <div className="border-b border-gray-100 px-6 py-5 dark:border-gray-800">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-base font-semibold text-gray-950 dark:text-white">
                  <FiDownload size={18} /> Source Code
                </div>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Download the current TAR working-tree source as a sanitized ZIP baseline.
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                <FiShield size={13} /> Server-side scan
              </div>
            </div>
          </div>

          <div className="grid gap-5 p-6 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="grid gap-3 sm:grid-cols-2">
              <Info label="Agent TARS" value={info?.agentTarsVersion || (loading ? 'Loading…' : '—')} />
              <Info label="TAR Patch" value={info?.patchVersion || (loading ? 'Loading…' : '—')} />
              <Info label="Upstream commit" value={shortSha(info?.upstreamCommit)} mono />
              <Info label="Current commit" value={shortSha(info?.currentCommit)} mono />
              <Info label="Source files" value={info ? info.sourceFileCount.toLocaleString() : '—'} />
              <Info label="Working tree" value={info ? (info.workingTreeDirty ? 'Modified by TAR patch' : 'Clean') : '—'} />
            </div>

            <a
              href={downloadUrl}
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-sm transition ${
                error || !info
                  ? 'pointer-events-none bg-gray-400 opacity-70'
                  : 'bg-gray-950 hover:bg-black dark:bg-white dark:text-gray-950 dark:hover:bg-gray-100'
              }`}
            >
              <FiDownload size={17} /> Download Source Code
            </a>
          </div>

          {error && (
            <div className="border-t border-red-100 bg-red-50 px-6 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              Source baseline inspection failed: {error}
            </div>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <SafetyCard title="Secrets excluded" text=".env files, private key files and other credential-bearing files are excluded before export." />
          <SafetyCard title="Unsafe folders excluded" text=".git, node_modules, logs, screenshots, recordings, backups, caches and build artifacts are omitted." />
          <SafetyCard title="Manifest included" text="Every ZIP includes BASELINE_MANIFEST.json with upstream, current commit, patch version and sanitized metadata." />
        </section>
      </div>
    </main>
  );
};

function shortSha(value?: string) {
  if (!value) return '—';
  return value.length > 12 ? value.slice(0, 12) : value;
}

const Info: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3 dark:border-gray-800 dark:bg-gray-950/40">
    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
    <div className={`mt-1 text-sm font-medium text-gray-800 dark:text-gray-100 ${mono ? 'font-mono' : ''}`}>{value}</div>
  </div>
);

const SafetyCard: React.FC<{ title: string; text: string }> = ({ title, text }) => (
  <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-gray-700/80 dark:bg-gray-900">
    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
      <FiCheckCircle className="text-emerald-500" size={16} /> {title}
    </div>
    <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">{text}</p>
  </div>
);

export default DeveloperHub;
