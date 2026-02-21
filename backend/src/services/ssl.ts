import { execSync, exec } from 'child_process';
import fs from 'fs';
import { getDb } from '../db/schema';

// SSL certificate management via Let's Encrypt (certbot)
// Certbot runs directly inside the backend container (installed via apk)
// Docker CLI is available to reload nginx in the frontend container
// Volumes: /etc/letsencrypt (certs), /var/www/certbot (webroot), /etc/nginx/ssl-conf (nginx SSL config)

const CERTBOT_WEBROOT = '/var/www/certbot';
const LETSENCRYPT_DIR = '/etc/letsencrypt';
const NGINX_SSL_CONF_DIR = '/etc/nginx/ssl-conf';
const NGINX_SSL_CONF = `${NGINX_SSL_CONF_DIR}/ssl.conf`;

// ─── Helper: get/set system settings ──────────────────────────
export function getSetting(key: string): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as any;
  return row?.value || '';
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
  ).run(key, value);
}

// ─── Get SSL status ──────────────────────────────────────────
export function getSSLStatus() {
  return {
    enabled: getSetting('ssl_enabled') === '1',
    domain: getSetting('ssl_domain'),
    email: getSetting('ssl_email'),
    status: getSetting('ssl_status'),           // inactive | pending | active | error
    issuedAt: getSetting('ssl_issued_at'),
    expiresAt: getSetting('ssl_expires_at'),
    errorMessage: getSetting('ssl_error'),
  };
}

// ─── Generate nginx SSL config ────────────────────────────────
function generateNginxSSLConfig(domain: string): string {
  return `# Auto-generated SSL config — do not edit manually
server {
    listen 443 ssl http2;
    server_name ${domain};

    ssl_certificate ${LETSENCRYPT_DIR}/live/${domain}/fullchain.pem;
    ssl_certificate_key ${LETSENCRYPT_DIR}/live/${domain}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # HSTS
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    root /usr/share/nginx/html;
    index index.html;

    # Global upload limit (10GB for video files)
    client_max_body_size 10G;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://backend:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 86400;
        client_max_body_size 10G;
    }

    # SSE support
    location /api/events {
        proxy_pass http://backend:3001;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400;
    }

    # Uploads proxy
    location /uploads/ {
        proxy_pass http://backend:3001;
    }
}
`;
}

// ─── Write nginx SSL config to shared volume ─────────────────
export function writeNginxSSLConfig(domain: string): void {
  if (!fs.existsSync(NGINX_SSL_CONF_DIR)) {
    fs.mkdirSync(NGINX_SSL_CONF_DIR, { recursive: true });
  }
  fs.writeFileSync(NGINX_SSL_CONF, generateNginxSSLConfig(domain), 'utf-8');
}

// ─── Remove nginx SSL config ─────────────────────────────────
export function removeNginxSSLConfig(): void {
  if (fs.existsSync(NGINX_SSL_CONF)) {
    fs.unlinkSync(NGINX_SSL_CONF);
  }
}

// ─── Reload nginx in frontend container ───────────────────────
function reloadNginx(): void {
  try {
    execSync('docker exec radiostream-frontend nginx -s reload', { timeout: 15000 });
    console.log('🔐 SSL: nginx reloaded successfully');
  } catch (err: any) {
    console.error('🔐 SSL: Failed to reload nginx:', err.message);
  }
}

// ─── Request certificate via certbot ──────────────────────────
export async function requestCertificate(domain: string, email: string): Promise<{ success: boolean; message: string }> {
  // Save settings immediately
  setSetting('ssl_domain', domain.trim());
  setSetting('ssl_email', email.trim());
  setSetting('ssl_status', 'pending');
  setSetting('ssl_error', '');

  // Ensure webroot directory exists
  try {
    if (!fs.existsSync(CERTBOT_WEBROOT)) {
      fs.mkdirSync(CERTBOT_WEBROOT, { recursive: true });
    }
  } catch (e) {
    // May not have permission, continue anyway
  }

  return new Promise((resolve) => {
    // Certbot is installed in this container (backend)
    // It uses webroot verification — the .well-known/acme-challenge/ is served by nginx (frontend)
    // via the shared certbot-webroot volume
    const certbotCmd = `certbot certonly --webroot --webroot-path=${CERTBOT_WEBROOT} ` +
      `-d ${domain.trim()} --email ${email.trim()} --agree-tos --non-interactive --no-eff-email ` +
      `--keep-until-expiring 2>&1`;

    console.log(`🔐 SSL: Running certbot for ${domain}...`);
    console.log(`🔐 SSL: Command: ${certbotCmd}`);

    exec(certbotCmd, { timeout: 120000 }, (error, stdout, stderr) => {
      const output = `${stdout}\n${stderr}`.trim();
      console.log(`🔐 SSL certbot output:\n${output}`);

      if (error) {
        setSetting('ssl_status', 'error');
        setSetting('ssl_error', output.slice(0, 500));
        resolve({ success: false, message: output.slice(0, 500) });
        return;
      }

      // Check if certificate was actually created
      const certPath = `${LETSENCRYPT_DIR}/live/${domain.trim()}/fullchain.pem`;
      if (fs.existsSync(certPath)) {
        // Write nginx SSL config to shared volume
        writeNginxSSLConfig(domain.trim());

        // Reload nginx in frontend container
        reloadNginx();

        // Update settings
        setSetting('ssl_enabled', '1');
        setSetting('ssl_status', 'active');
        setSetting('ssl_issued_at', new Date().toISOString());
        // Let's Encrypt certs expire in 90 days
        const expires = new Date();
        expires.setDate(expires.getDate() + 90);
        setSetting('ssl_expires_at', expires.toISOString());
        setSetting('ssl_error', '');

        resolve({ success: true, message: `✅ SSL certificate installed successfully for ${domain}` });
      } else {
        setSetting('ssl_status', 'error');
        setSetting('ssl_error', 'Certificate files not found after certbot run');
        resolve({ success: false, message: 'Certificate files not found after certbot run. Output: ' + output.slice(0, 300) });
      }
    });
  });
}

// ─── Revoke / disable SSL ─────────────────────────────────────
export function disableSSL(): { success: boolean; message: string } {
  try {
    removeNginxSSLConfig();

    // Reload nginx to drop SSL
    reloadNginx();

    setSetting('ssl_enabled', '0');
    setSetting('ssl_status', 'inactive');
    setSetting('ssl_error', '');

    return { success: true, message: 'SSL disabled successfully' };
  } catch (err: any) {
    return { success: false, message: err.message || 'Failed to disable SSL' };
  }
}

// ─── Auto-renewal timer (runs every 12 hours) ────────────────
let renewalTimer: NodeJS.Timeout | null = null;

export function startAutoRenewal(): void {
  if (renewalTimer) return;

  // On startup: restore SSL config if it was active
  restoreSSLConfigOnStartup();

  // Check renewal after 30 seconds
  setTimeout(() => renewIfNeeded(), 30000);

  // Then every 12 hours
  renewalTimer = setInterval(() => renewIfNeeded(), 12 * 60 * 60 * 1000);
  console.log('🔐 SSL: Auto-renewal timer started (every 12h)');
}

function restoreSSLConfigOnStartup(): void {
  try {
    const enabled = getSetting('ssl_enabled');
    const domain = getSetting('ssl_domain');
    if (enabled === '1' && domain) {
      const certPath = `${LETSENCRYPT_DIR}/live/${domain}/fullchain.pem`;
      if (fs.existsSync(certPath)) {
        writeNginxSSLConfig(domain);
        console.log(`🔐 SSL: Restored SSL config for ${domain} on startup`);
        // Give nginx a moment to start, then reload
        setTimeout(() => reloadNginx(), 5000);
      } else {
        console.log(`🔐 SSL: Certificate files missing for ${domain}, marking as inactive`);
        setSetting('ssl_status', 'inactive');
        setSetting('ssl_enabled', '0');
      }
    }
  } catch (err: any) {
    console.error('🔐 SSL: Error restoring config on startup:', err.message);
  }
}

async function renewIfNeeded(): Promise<void> {
  const enabled = getSetting('ssl_enabled');
  if (enabled !== '1') return;

  const domain = getSetting('ssl_domain');
  if (!domain) return;

  console.log('🔐 SSL: Checking certificate renewal...');
  try {
    execSync(`certbot renew --webroot --webroot-path=${CERTBOT_WEBROOT} --quiet --no-random-sleep-on-renew 2>&1`, { timeout: 120000 });
    // If renewal happened, reload nginx
    reloadNginx();
    console.log('🔐 SSL: Renewal check complete');
  } catch (err: any) {
    console.error('🔐 SSL: Renewal check failed:', err.message);
  }
}
