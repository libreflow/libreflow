/**
 * LibreFlow — Cloudflare Worker : proxy de mise à jour
 *
 * Routes :
 *   GET /                        → latest.json (metadata Tauri, URLs réécrites)
 *   GET /assets/{filename}       → binaire d'installation depuis GitHub (stream)
 *
 * Variables d'environnement (secrets Cloudflare) :
 *   GITHUB_TOKEN   Fine-grained PAT — permissions : Contents:Read, Metadata:Read
 *
 * Déploiement :
 *   wrangler secret put GITHUB_TOKEN   ← coller le token
 *   wrangler deploy
 */

const GITHUB_OWNER = 'libreflow';
const GITHUB_REPO  = 'libreflow';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Appel GitHub API avec auth + headers recommandés.
 * redirect: 'follow' — requis pour le téléchargement d'assets (302 → CDN GitHub).
 */
function ghFetch(env, url, accept = 'application/vnd.github+json') {
  return fetch(url, {
    headers: {
      'Authorization':        `Bearer ${env.GITHUB_TOKEN}`,
      'Accept':               accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent':           'LibreFlow-Updater/1.0',
    },
    redirect: 'follow',
  });
}

/** Récupère le dernier release GitHub (JSON). */
async function getLatestRelease(env) {
  const resp = await ghFetch(
    env,
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
  );
  if (!resp.ok) {
    throw new Error(`GitHub API ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

/** Retourne une réponse d'erreur JSON. */
function errJson(msg, status = 500) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Route : GET / → latest.json ───────────────────────────────────────────────

/**
 * Récupère latest.json depuis les assets du dernier release GitHub privé,
 * puis remplace les URLs de téléchargement GitHub par les URLs du Worker
 * afin que le client Tauri passe toujours par ce proxy authentifié.
 *
 * Remplacement :
 *   https://github.com/libreflow/libreflow/releases/download/{tag}/{file}
 *   → https://{worker-host}/assets/{file}
 */
async function handleLatestJson(env, workerBase) {
  let release;
  try {
    release = await getLatestRelease(env);
  } catch (e) {
    return errJson(`GitHub API error: ${e.message}`, 502);
  }

  const asset = release.assets?.find(a => a.name === 'latest.json');
  if (!asset) {
    return errJson('latest.json not found in release assets — has the release been published?', 404);
  }

  const assetResp = await ghFetch(env, asset.url, 'application/octet-stream');
  if (!assetResp.ok) {
    return errJson(`Failed to fetch latest.json asset: ${assetResp.status}`, 502);
  }

  const raw = await assetResp.text();

  // Réécrire les URLs GitHub → URLs Worker pour que Tauri passe par /assets/
  // Pattern : https://github.com/{owner}/{repo}/releases/download/{tag}/{filename}
  const rewritten = raw.replace(
    new RegExp(
      `https://github\\.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/[^/]+/([^"\\s]+)`,
      'g'
    ),
    `${workerBase}/assets/$1`
  );

  return new Response(rewritten, {
    status: 200,
    headers: {
      'Content-Type':  'application/json',
      'Cache-Control': 'public, max-age=300', // 5 min — limite les appels GitHub API
    },
  });
}

// ── Route : GET /assets/{filename} → binaire ─────────────────────────────────

/**
 * Trouve l'asset par nom dans le dernier release GitHub et le streame au client.
 * Le binaire transite par le Worker (streaming ReadableStream, pas de chargement
 * en mémoire) — CPU time négligeable malgré la taille du fichier.
 */
async function handleAssetDownload(env, filename) {
  let release;
  try {
    release = await getLatestRelease(env);
  } catch (e) {
    return errJson(`GitHub API error: ${e.message}`, 502);
  }

  const asset = release.assets?.find(a => a.name === filename);
  if (!asset) {
    return errJson(`Asset not found: ${filename}`, 404);
  }

  // Téléchargement avec Accept: application/octet-stream → GitHub suit le redirect CDN
  const dlResp = await ghFetch(env, asset.url, 'application/octet-stream');
  if (!dlResp.ok) {
    return errJson(`Asset download failed: ${dlResp.status}`, 502);
  }

  // Streamer le body sans le charger en mémoire (ReadableStream pass-through)
  return new Response(dlResp.body, {
    status: 200,
    headers: {
      'Content-Type':        'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Content-Length retransmis si disponible (progress bar dans le toast Tauri)
      ...(dlResp.headers.has('content-length')
        ? { 'Content-Length': dlResp.headers.get('content-length') }
        : {}),
      'Cache-Control': 'public, max-age=3600', // 1h — un release ne change pas
    },
  });
}

// ── Entrée principale ─────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url        = new URL(request.url);
    const workerBase = url.origin; // ex. https://libreflow-update.ACCOUNT.workers.dev

    // Route /
    if (url.pathname === '/' || url.pathname === '') {
      return handleLatestJson(env, workerBase);
    }

    // Route /assets/{filename}
    const m = url.pathname.match(/^\/assets\/(.+)$/);
    if (m) {
      return handleAssetDownload(env, decodeURIComponent(m[1]));
    }

    return new Response('Not Found', { status: 404 });
  },
};
