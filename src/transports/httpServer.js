const http = require('http');

// Use built-in fetch on Node 18+, fallback to node-fetch on older runtimes.
const fetch =
  global.fetch ||
  ((...args) => import('node-fetch').then(({ default: fn }) => fn(...args)));

if (typeof ReadableStream === 'undefined') {
  const { ReadableStream } = require('stream/web');
  global.ReadableStream = ReadableStream;
}

async function exchangeCodeForUser(code, { clientId, clientSecret, redirectUri }) {
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      scope: 'identify',
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Discord token exchange failed: ${text}`);
  }

  const tokenData = await tokenRes.json();
  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    const text = await userRes.text();
    throw new Error(`Discord user fetch failed: ${text}`);
  }

  return userRes.json();
}

function respondJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

function startHttpServer({ config, sessionService, formatUserForClient }) {
  const { httpPort } = config.server;
  const { clientId, clientSecret, redirectUri } = config.discord;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/auth/login') {
      const authorizeUrl = new URL('https://discord.com/api/oauth2/authorize');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('scope', 'identify');
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('prompt', 'consent');

      res.writeHead(302, { Location: authorizeUrl.toString() });
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/auth/callback') {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<p>Discord login failed: ${error}</p>`);
        return;
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<p>Missing authorization code.</p>');
        return;
      }

      try {
        const user = await exchangeCodeForUser(code, { clientId, clientSecret, redirectUri });
        const token = sessionService.signSession(user);
        const safeUser = formatUserForClient(user);
        const payload = JSON.stringify({ token, user: safeUser });
        const html = `
          <!doctype html>
          <html>
            <body style="background:#0b0d11;color:#f7f7f7;font-family:Arial;padding:24px;">
              <h2>Discord login listo</h2>
              <p>Puedes cerrar esta ventana.</p>
              <script>
                (function() {
                  const payload = ${JSON.stringify(payload)};
                  if (window.opener) {
                    window.opener.postMessage(JSON.parse(payload), '*');
                    window.close();
                  } else {
                    document.body.innerHTML += '<pre>' + payload + '</pre>';
                  }
                })();
              </script>
            </body>
          </html>
        `;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<p>Error during Discord login: ${err.message}</p>`);
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/auth/session') {
      const token = url.searchParams.get('token');
      const session = sessionService.getSession(token);
      if (!session) {
        respondJson(res, 401, { ok: false, error: 'Invalid session' });
        return;
      }
      respondJson(res, 200, { ok: true, user: formatUserForClient(session.user) });
      return;
    }

    respondJson(res, 404, { ok: false, error: 'Not found' });
  });

  server.listen(httpPort, () => {
    console.log(`HTTP auth server listening on http://localhost:${httpPort}`);
    console.log(`Discord redirect URI: ${redirectUri}`);
  });

  return server;
}

module.exports = {
  startHttpServer,
};
