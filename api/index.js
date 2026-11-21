const https = require('https');
const fs = require('fs');
const path = require('path');

// Charge .env en local si présent (sur Vercel, les variables d'environnement du Dashboard ou .env sont injectées)
function loadDotEnv() {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '.env')
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

loadDotEnv();

function getEnvAccounts() {
  const map = new Map();
  const u1 = (process.env.ADMIN_USER_1 || 'sroff').toLowerCase();
  map.set(u1, {
    defaultPassword: process.env.ADMIN_PASS_1 || 'sroff',
    firebaseEmail: process.env.ADMIN_FIREBASE_EMAIL_1 || `${u1}@wordcloud.sroff.dev`,
    firebasePass: process.env.ADMIN_FIREBASE_PASS_1 || 'sroff_wc_auth_2026'
  });

  const u2 = (process.env.ADMIN_USER_2 || 'vincent').toLowerCase();
  map.set(u2, {
    defaultPassword: process.env.ADMIN_PASS_2 || 'vincent',
    firebaseEmail: process.env.ADMIN_FIREBASE_EMAIL_2 || `${u2}@wordcloud.sroff.dev`,
    firebasePass: process.env.ADMIN_FIREBASE_PASS_2 || 'vincent_wc_auth_2026'
  });
  return map;
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  if (req.body && typeof req.body === 'object') {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === 'string' && req.body.length > 0) {
    try {
      return Promise.resolve(JSON.parse(req.body));
    } catch (e) {
      return Promise.reject(new Error('Invalid JSON'));
    }
  }
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function postToDiscordWebhook(targetUrlString, payload) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrlString);
    } catch (e) {
      return reject(new Error('URL de Webhook Discord invalide.'));
    }
    if (!/^https:$/.test(parsed.protocol) || !/discord(app)?\.com$/i.test(parsed.hostname)) {
      return reject(new Error('Domaine de Webhook non autorisé.'));
    }

    const bodyData = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': bodyData.length
      }
    }, (res) => {
      let respText = '';
      res.on('data', c => respText += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true });
        } else {
          reject(new Error(`Discord a répondu avec le code ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.write(bodyData);
    req.end();
  });
}

module.exports = async function apiHandler(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. GET /api/config
  if (req.method === 'GET' && pathname === '/api/config') {
    const allowedAccounts = Array.from(getEnvAccounts().keys());
    return sendJson(res, 200, {
      publicDomain: process.env.PUBLIC_DOMAIN || 'wordcloud.sroff.dev',
      logoUrl: process.env.DISCORD_LOGO_URL || 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSdh9C0OGb5i4KkQHUN8JBak_1JfebJBPx5SVoREuH8OdQJg-s6KQUSN3k&s=10',
      allowedUsernames: allowedAccounts,
      firebaseConfig: {
        apiKey: process.env.FIREBASE_API_KEY || '',
        authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
        projectId: process.env.FIREBASE_PROJECT_ID || '',
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
        appId: process.env.FIREBASE_APP_ID || '',
        measurementId: process.env.FIREBASE_MEASUREMENT_ID || ''
      }
    });
  }

  // 2. POST /api/auth/verify
  if (req.method === 'POST' && pathname === '/api/auth/verify') {
    try {
      const body = await readJsonBody(req);
      const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const hasCustomFirestorePassword = Boolean(body.hasCustomFirestorePassword);

      const accounts = getEnvAccounts();
      const acc = accounts.get(username);
      if (!acc) {
        return sendJson(res, 401, { error: 'Identifiant ou mot de passe incorrect.' });
      }

      if (!hasCustomFirestorePassword && password !== acc.defaultPassword) {
        return sendJson(res, 401, { error: 'Identifiant ou mot de passe incorrect.' });
      }

      return sendJson(res, 200, {
        ok: true,
        username,
        firebaseEmail: acc.firebaseEmail,
        firebasePass: acc.firebasePass
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // 3. POST /api/discord/invite
  if (req.method === 'POST' && pathname === '/api/discord/invite') {
    try {
      const body = await readJsonBody(req);
      const code = String(body.code || '').toUpperCase();
      const roomTitle = String(body.roomTitle || code).slice(0, 80);
      const durationMin = Number(body.durationMin) || 5;
      const hostName = String(body.username || 'Admin').slice(0, 40);
      const customWebhookUrl = typeof body.customWebhookUrl === 'string' ? body.customWebhookUrl.trim() : '';

      const targetWebhook = customWebhookUrl || process.env.DISCORD_WEBHOOK_URL;
      if (!targetWebhook) {
        return sendJson(res, 500, { error: 'DISCORD_WEBHOOK_URL non configuré dans les variables d’environnement Vercel.' });
      }

      const domain = process.env.PUBLIC_DOMAIN || 'wordcloud.sroff.dev';
      const joinUrl = `https://${domain}/join/${code}`;
      const logoUrl = process.env.DISCORD_LOGO_URL || 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSdh9C0OGb5i4KkQHUN8JBak_1JfebJBPx5SVoREuH8OdQJg-s6KQUSN3k&s=10';

      const payload = {
        username: 'WordCloud',
        avatar_url: logoUrl,
        embeds: [
          {
            author: {
              name: 'WordCloud • Session Interactive',
              icon_url: logoUrl
            },
            title: '🟢 Le nuage de mots est ouvert !',
            description: `La session **${roomTitle}** vient d'ouvrir.\nEnvoyez vos mots, phrases et images en direct !\n\n🚀 **[Rejoindre la session maintenant](${joinUrl})**`,
            color: 0x5865F2,
            thumbnail: logoUrl ? { url: logoUrl } : undefined,
            fields: [
              {
                name: '🔑 Code d’accès',
                value: `\`${code}\``,
                inline: true
              },
              {
                name: '⏱️ Durée',
                value: `\`${durationMin} min\``,
                inline: true
              },
              {
                name: '🔗 Lien direct',
                value: joinUrl,
                inline: false
              }
            ],
            footer: {
              text: `${domain} • Hôte : ${hostName}`,
              icon_url: logoUrl
            },
            timestamp: new Date().toISOString()
          }
        ]
      };

      await postToDiscordWebhook(targetWebhook, payload);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 4. POST /api/discord/feedback
  if (req.method === 'POST' && pathname === '/api/discord/feedback') {
    try {
      const body = await readJsonBody(req);
      const category = body.category === 'suggestion' ? 'suggestion' : 'bug';
      const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1200) : '';
      const authorName = typeof body.authorName === 'string' && body.authorName.trim()
        ? body.authorName.trim().slice(0, 40)
        : 'Anonyme';

      if (!message) {
        return sendJson(res, 400, { error: 'Le message est vide.' });
      }

      const baseWebhook = process.env.DISCORD_WEBHOOK_URL;
      if (!baseWebhook) {
        return sendJson(res, 500, { error: 'DISCORD_WEBHOOK_URL non configuré dans les variables d’environnement Vercel.' });
      }

      const isBug = category === 'bug';
      const threadId = isBug
        ? process.env.DISCORD_BUG_THREAD_ID
        : process.env.DISCORD_SUGGESTION_THREAD_ID;

      const targetUrl = threadId
        ? `${baseWebhook}?thread_id=${encodeURIComponent(threadId)}`
        : baseWebhook;

      const domain = process.env.PUBLIC_DOMAIN || 'wordcloud.sroff.dev';
      const logoUrl = process.env.DISCORD_LOGO_URL || 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSdh9C0OGb5i4KkQHUN8JBak_1JfebJBPx5SVoREuH8OdQJg-s6KQUSN3k&s=10';

      const payload = {
        username: 'WordCloud • Retours',
        avatar_url: logoUrl,
        embeds: [
          {
            author: {
              name: 'WordCloud • Bug & Suggestion',
              icon_url: logoUrl
            },
            title: isBug ? '🐛 Signalement de Bug' : '💡 Suggestion d’ajout',
            description: message,
            color: isBug ? 0xdc2626 : 0x2563eb,
            thumbnail: logoUrl ? { url: logoUrl } : undefined,
            fields: [
              {
                name: '📂 Catégorie',
                value: isBug ? '`Bug`' : '`Suggestion d’ajout`',
                inline: true
              },
              {
                name: '👤 Envoyé par',
                value: `\`${authorName}\``,
                inline: true
              }
            ],
            footer: {
              text: domain,
              icon_url: logoUrl
            },
            timestamp: new Date().toISOString()
          }
        ]
      };

      await postToDiscordWebhook(targetUrl, payload);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  return sendJson(res, 404, { error: 'API endpoint not found' });
};

