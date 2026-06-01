/* /api/data — shared CSV data, stored in Vercel Blob.
 *
 *   GET  /api/data           → { rows, filename, uploadedAt, rowCount }
 *   GET  /api/data?backups=1 → { backups: [{ url, uploadedAt, pathname, size }] }
 *   POST /api/data           → body { rows: [...], filename: "x.csv" }
 *                              returns { ok:true, uploadedAt, filename, rowCount, backedUp, url }
 *
 * Live data lives at a single Blob `dashboard-data.json`, overwritten on every upload.
 * SAFETY: before each overwrite the *existing* (last-known-good) blob is copied to
 * `backups/dashboard-data-<uploadedAt>.json`, so a bad upload can be rolled back.
 * The newest BACKUP_KEEP backups are retained; older ones are pruned.
 *
 * Required env: BLOB_READ_WRITE_TOKEN (auto-injected when you attach a Blob store
 * to the Vercel project).
 */
import { put, list, del } from '@vercel/blob';

export const config = {
  runtime: 'nodejs',
  // Allow uploads up to ~50 MB (Vercel defaults to 4.5 MB on Node functions).
  api: { bodyParser: { sizeLimit: '50mb' } }
};

const BLOB_KEY      = 'dashboard-data.json';
const BACKUP_PREFIX = 'backups/dashboard-data-';
const BACKUP_KEEP   = 15;            // how many historical backups to retain

// Fetch the current live blob's parsed JSON (or null if none).
async function readLive() {
  const { blobs } = await list({ prefix: BLOB_KEY });
  if (!blobs.length) return null;
  const latest = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
  const r = await fetch(latest.url, { cache: 'no-store' });
  if (!r.ok) throw new Error('Blob fetch failed: HTTP ' + r.status);
  return r.json();
}

// Copy the soon-to-be-overwritten live data into a timestamped backup, then prune.
async function archiveExisting(existing) {
  if (!existing || !Array.isArray(existing.rows) || !existing.rows.length) return;
  // Name the backup after the data's own uploadedAt so it's stable & sortable.
  const stamp = (existing.uploadedAt || new Date().toISOString()).replace(/[:.]/g, '-');
  await put(`${BACKUP_PREFIX}${stamp}.json`, JSON.stringify(existing), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  // Prune: keep only the newest BACKUP_KEEP backups.
  try {
    const { blobs } = await list({ prefix: BACKUP_PREFIX });
    const stale = blobs
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
      .slice(BACKUP_KEEP);
    if (stale.length) await del(stale.map(b => b.url));
  } catch (e) {
    console.warn('backup prune failed (non-fatal):', e.message);
  }
}

export default async function handler(req, res) {
  // Permissive CORS — same-origin in normal use, but doesn't hurt
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      // ?backups=1 → list available restore points (most recent first)
      if (req.query && (req.query.backups === '1' || req.query.backups === 'true')) {
        const { blobs } = await list({ prefix: BACKUP_PREFIX });
        const backups = blobs
          .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
          .map(b => ({ url: b.url, uploadedAt: b.uploadedAt, pathname: b.pathname, size: b.size }));
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        return res.status(200).json({ backups });
      }

      const data = await readLive();
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      if (!data) return res.status(200).json({ rows: [], filename: null, uploadedAt: null });
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {
          return res.status(400).json({ error: 'Invalid JSON body' });
        }
      }
      if (!body || !Array.isArray(body.rows) || !body.rows.length) {
        return res.status(400).json({ error: 'rows[] required and must be non-empty' });
      }

      // SAFETY: archive the current live data before we overwrite it, so a bad
      // upload never wipes the last-known-good copy beyond recovery.
      let existing = null;
      try {
        existing = await readLive();
      } catch (e) {
        console.warn('could not read existing blob before overwrite:', e.message);
      }
      if (existing) await archiveExisting(existing);

      const payload = {
        rows: body.rows,
        filename: String(body.filename || 'upload.csv'),
        uploadedAt: new Date().toISOString(),
        rowCount: body.rows.length
      };
      const blob = await put(BLOB_KEY, JSON.stringify(payload), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return res.status(200).json({
        ok: true,
        uploadedAt: payload.uploadedAt,
        filename: payload.filename,
        rowCount: payload.rowCount,
        backedUp: !!existing,
        url: blob.url
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('/api/data error:', e);
    return res.status(500).json({ error: e.message || 'Internal error' });
  }
}
