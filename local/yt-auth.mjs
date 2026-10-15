// One-time YouTube sign-in. Opens Google's consent page in the browser, catches the
// redirect on localhost, and saves client id/secret + refresh token to
// ~/FindGreatArchitecture/.yt-auth.json (chmod 600). Nothing is printed or committed.
// Scopes: upload videos + read the channel (titles, stats). Nothing else.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const BASE = path.join(os.homedir(), 'FindGreatArchitecture');
const client = JSON.parse(fs.readFileSync(path.join(BASE, '.yt-client.json'), 'utf8')).installed;
const OUT = path.join(BASE, '.yt-auth.json');
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
const state = crypto.randomBytes(12).toString('hex');
const verifier = crypto.randomBytes(48).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
  const done = (msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<p style="font:18px system-ui;margin:40px">${msg}</p>`); };
  if (u.searchParams.get('state') !== state) return done('Sign-in check failed (state mismatch). Close this tab and run it again.');
  if (u.searchParams.get('error')) { done('Sign-in was cancelled. You can close this tab.'); console.log('cancelled:', u.searchParams.get('error')); process.exit(1); }
  const r = await fetch(client.token_uri, {
    method: 'POST',
    body: new URLSearchParams({
      code: u.searchParams.get('code'), client_id: client.client_id, client_secret: client.client_secret,
      redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier,
    }),
  });
  const tok = await r.json();
  if (!tok.refresh_token) { done('Google did not return a long-lived key. Close this tab and run it again.'); console.log('no refresh token:', tok.error || Object.keys(tok)); process.exit(1); }
  // Check which channel this key belongs to.
  const ch = await (await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
  const channel = ch.items?.[0] ? { id: ch.items[0].id, title: ch.items[0].snippet.title, handle: ch.items[0].snippet.customUrl } : null;
  fs.writeFileSync(OUT, JSON.stringify({ client_id: client.client_id, client_secret: client.client_secret, refresh_token: tok.refresh_token, channel }, null, 1), { mode: 0o600 });
  done(`Connected${channel ? ` to <b>${channel.title}</b> (${channel.handle || channel.id})` : ''}. You can close this tab.`);
  console.log('saved', OUT, '· channel:', channel ? `${channel.title} ${channel.handle || ''} ${channel.id}` : 'none found');
  server.close(); setTimeout(() => process.exit(0), 300);
});
let redirectUri;
server.listen(0, '127.0.0.1', () => {
  redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const url = new URL(client.auth_uri);
  url.search = new URLSearchParams({
    client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  console.log('Opening Google sign-in in your browser…');
  console.log('If no tab opened, paste this into Chrome:\n' + url.href); execFile('open', ['-a', 'Google Chrome', url.href]);
});
setTimeout(() => { console.log('timed out after 60 min'); process.exit(1); }, 60 * 60e3);
