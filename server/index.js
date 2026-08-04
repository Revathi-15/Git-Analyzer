require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Octokit } = require('@octokit/rest');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Startup check ─────────────────────────────────────────────────────────────
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITINGEST_URL = process.env.GITINGEST_API_URL || 'http://127.0.0.1:8001';

console.log('[Server] GEMINI_API_KEY:', GEMINI_KEY ? `set (${GEMINI_KEY.slice(0,8)}...)` : 'MISSING ⚠️');
console.log('[Server] GITHUB_TOKEN:', GITHUB_TOKEN ? 'set' : 'not set (will use unauthenticated GitHub API)');
console.log('[Server] GITINGEST_API_URL:', GITINGEST_URL);

// ── Redis (optional) ──────────────────────────────────────────────────────────
let redis = null;
if (process.env.REDIS_URL) {
  try {
    const Redis = require('ioredis');
    redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 3000 });
    redis.on('error', (e) => console.warn('[Redis] Error:', e.message));
    redis.connect().catch(() => { redis = null; });
    console.log('[Server] Redis: connecting...');
  } catch (e) {
    console.warn('[Server] Redis: not available -', e.message);
  }
}

const CACHE_TTL = 6 * 60 * 60;
const RATE_LIMIT = 100;
const RATE_WINDOW = 24 * 60 * 60;

async function getCache(key) {
  try { return redis ? JSON.parse(await redis.get(key)) : null; } catch { return null; }
}
async function setCache(key, value, ttl = CACHE_TTL) {
  try { if (redis) await redis.setex(key, ttl, JSON.stringify(value)); } catch {}
}
async function getRateLimitData(ip) {
  const defaults = { allowed: true, remaining: RATE_LIMIT, limit: RATE_LIMIT, resetAt: Math.floor(Date.now() / 1000) + RATE_WINDOW };
  try {
    if (!redis) return defaults;
    const raw = await redis.get(`rl:${ip}`);
    if (!raw) return defaults;
    const { count, resetAt } = JSON.parse(raw);
    if (Date.now() / 1000 > resetAt) return defaults;
    return { allowed: count < RATE_LIMIT, remaining: Math.max(0, RATE_LIMIT - count), limit: RATE_LIMIT, resetAt };
  } catch { return defaults; }
}
async function incrementRateLimit(ip) {
  try {
    if (!redis) return { allowed: true, remaining: RATE_LIMIT - 1, limit: RATE_LIMIT, resetAt: Math.floor(Date.now() / 1000) + RATE_WINDOW };
    const key = `rl:${ip}`;
    const raw = await redis.get(key);
    let count = 1, resetAt = Math.floor(Date.now() / 1000) + RATE_WINDOW;
    if (raw) { const p = JSON.parse(raw); if (Date.now() / 1000 < p.resetAt) { count = p.count + 1; resetAt = p.resetAt; } }
    await redis.setex(key, resetAt - Math.floor(Date.now() / 1000), JSON.stringify({ count, resetAt }));
    return { allowed: count <= RATE_LIMIT, remaining: Math.max(0, RATE_LIMIT - count), limit: RATE_LIMIT, resetAt };
  } catch { return { allowed: true, remaining: RATE_LIMIT - 1, limit: RATE_LIMIT, resetAt: Math.floor(Date.now() / 1000) + RATE_WINDOW }; }
}
function getIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? fwd.split(',')[0].trim() : req.socket?.remoteAddress) || 'unknown';
}

// ── Gemini ────────────────────────────────────────────────────────────────────
function getGeminiClient() {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY is not set in .env or .env.local');
  return new GoogleGenerativeAI(GEMINI_KEY);
}

async function askGemini(prompt) {
  const ai = getGeminiClient();
  const model = ai.getGenerativeModel({ model: 'gemini-flash-lite-latest' });
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
  });
  return result.response.text();
}

function buildPrompt(query, history, tree, content) {
  const hist = history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
  return `You are a helpful assistant that answers questions about a GitHub codebase.

QUESTION: ${query}

REPOSITORY TREE:
${tree}

CODEBASE:
${content.slice(0, 80000)}

CONVERSATION HISTORY:
${hist}

Instructions:
- Answer concisely and accurately based on the actual code above
- Use markdown with code blocks (language tags) when showing code
- Reference specific file paths when relevant`;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, gemini: !!GEMINI_KEY, github: !!GITHUB_TOKEN });
});

// Rate limit status
app.get('/api/rate-limit', async (req, res) => {
  try {
    const info = await getRateLimitData(getIP(req));
    res.json({ success: true, ...info });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Collect repo data — builds file tree from GitHub API directly, no Python needed
app.post('/api/collect-repo-data', async (req, res) => {
  try {
    const { username, repo, force = false } = req.body;
    if (!username || !repo) return res.status(400).json({ success: false, error: 'username and repo are required' });

    const cacheKey = `repo:${username}:${repo}`;
    if (!force) {
      const cached = await getCache(cacheKey);
      if (cached) {
        console.log(`[Cache] Hit for ${username}/${repo}`);
        return res.json({ success: true, data: cached });
      }
    }

    console.log(`[GitHub] Fetching tree for ${username}/${repo}`);
    const octokit = new Octokit({ auth: GITHUB_TOKEN || undefined });

    // Get default branch
    const { data: repoInfo } = await octokit.repos.get({ owner: username, repo });
    const branch = repoInfo.default_branch;

    // Get full recursive tree
    const { data: treeData } = await octokit.git.getTree({
      owner: username, repo,
      tree_sha: branch,
      recursive: '1',
    });

    // Build nested file tree from flat GitHub tree
    const files = buildFileTreeFromGitHub(treeData.tree);

    // Build a text tree for AI context
    const treeText = treeData.tree
      .filter(f => f.path)
      .map(f => f.path)
      .join('\n');

    const data = {
      summary: `${repoInfo.description || repoInfo.name} — ${repoInfo.stargazers_count} stars`,
      tree: treeText,
      content: '',  // fetched on demand per file
      files,
    };

    await setCache(cacheKey, data);
    console.log(`[GitHub] Got ${treeData.tree.length} items for ${username}/${repo}`);
    res.json({ success: true, data });
  } catch (e) {
    console.error('[collect-repo-data]', e.message);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

// Get single file content from GitHub
app.get('/api/file-content', async (req, res) => {
  try {
    const { username, repo, path: filePath } = req.query;
    if (!username || !repo || !filePath) return res.status(400).json({ error: 'username, repo, path required' });

    const octokit = new Octokit({ auth: GITHUB_TOKEN || undefined });
    const ext = String(filePath).split('.').pop()?.toLowerCase() || '';
    const isBinary = ['jpg','jpeg','png','gif','svg','webp','bmp','ico','pdf'].includes(ext);

    const { data: file } = await octokit.repos.getContent({
      owner: String(username), repo: String(repo), path: String(filePath),
    });

    if (Array.isArray(file)) return res.status(400).json({ error: 'Path is a directory' });
    if (!('content' in file)) return res.status(400).json({ error: 'No content available' });

    const content = isBinary
      ? file.content
      : Buffer.from(file.content, 'base64').toString('utf-8');

    res.json({ content, isBinary });
  } catch (e) {
    console.error('[file-content]', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Gemini AI chat
app.post('/api/gemini', async (req, res) => {
  try {
    const ip = getIP(req);
    const rl = await getRateLimitData(ip);
    if (!rl.allowed) {
      return res.status(429).json({
        success: false, rateLimited: true,
        error: `Daily limit of ${rl.limit} AI requests reached. Resets in ${Math.ceil((rl.resetAt - Date.now() / 1000) / 3600)}h.`,
        rateLimit: rl,
      });
    }

    const { username, repo, query, filePath, fetchOnlyCurrentFile = false, history = [] } = req.body;
    if (!query) return res.status(400).json({ success: false, error: 'query is required' });

    let prompt = '';

    if (filePath && fetchOnlyCurrentFile) {
      const octokit = new Octokit({ auth: GITHUB_TOKEN || undefined });
      try {
        const { data: file } = await octokit.repos.getContent({ owner: username, repo, path: filePath });
        const content = Array.isArray(file) || !('content' in file)
          ? '' : Buffer.from(file.content, 'base64').toString('utf-8');
        prompt = `Answer this question about the file "${filePath}":\n\n${query}\n\nFILE CONTENT:\n${content}`;
      } catch {
        prompt = `Answer this question about the file "${filePath}" in ${username}/${repo}:\n\n${query}`;
      }
    } else {
      const cacheKey = `repo:${username}:${repo}`;
      const cached = await getCache(cacheKey);
      if (cached) {
        prompt = buildPrompt(query, history, cached.tree || '', cached.content || '');
      } else {
        // No cache — answer from general knowledge
        prompt = `You are a helpful AI assistant. The user is asking about the GitHub repository ${username}/${repo}.\n\nQUESTION: ${query}\n\nNote: Repository data is not cached yet. Answer based on general knowledge.`;
      }
    }

    console.log(`[Gemini] Request from ${ip} for ${username}/${repo}`);
    const response = await askGemini(prompt);
    const rateLimit = await incrementRateLimit(ip);

    res.json({ success: true, response, rateLimit });
  } catch (e) {
    console.error('[gemini] Error:', e.message);
    res.status(500).json({
      success: false,
      error: e.message.includes('API_KEY') || e.message.includes('GEMINI')
        ? 'Gemini API key is missing or invalid. Check your .env file.'
        : e.message,
    });
  }
});

// ── File tree builder from GitHub API ────────────────────────────────────────
// GitHub gives a flat list: [{ path: 'src/App.tsx', type: 'blob' }, ...]
// We convert it to a nested tree
function buildFileTreeFromGitHub(items) {
  const root = [];
  const dirMap = {}; // path → node

  // Sort so directories come before their children
  const sorted = [...items].sort((a, b) => (a.path || '').localeCompare(b.path || ''));

  for (const item of sorted) {
    if (!item.path) continue;
    const parts = item.path.split('/');
    const name = parts[parts.length - 1];
    const isDir = item.type === 'tree';

    const node = {
      name,
      path: item.path,
      type: isDir ? 'directory' : 'file',
      ...(isDir ? { children: [] } : {}),
    };

    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = dirMap[parentPath];
      if (parent && parent.children) {
        parent.children.push(node);
      }
    }

    if (isDir) dirMap[item.path] = node;
  }

  return root;
}

// ── Legacy string-based tree builder (kept for GitIngest fallback) ────────────
function buildFileTree(treeStr) {
  if (!treeStr) return []
  const lines = treeStr.split('\n')
  const root = []
  const stack = [{ node: { children: root, path: '' }, depth: -1 }]
  for (const line of lines) {
    if (!line.trim()) continue
    const cleaned = line.replace(/[│├└─]/g, ' ')
    const indent = cleaned.length - cleaned.trimStart().length
    const depth = Math.floor(indent / 2)
    const rawName = cleaned.trim()
    if (!rawName || rawName === '.' || rawName === '..') continue
    const isDir = rawName.endsWith('/')
    const name = rawName.replace(/\/$/, '')
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop()
    const parent = stack[stack.length - 1].node
    const node = { name, path: parent.path ? `${parent.path}/${name}` : name, type: isDir ? 'directory' : 'file', ...(isDir ? { children: [] } : {}) }
    parent.children.push(node)
    if (isDir) stack.push({ node, depth })
  }
  return root
}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.SERVER_PORT || 3001;
app.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
  console.log(`[Server] Proxying GitIngest at ${GITINGEST_URL}`);
});
