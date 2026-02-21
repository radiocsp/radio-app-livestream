import { FastifyInstance } from 'fastify';
import { getSSLStatus, requestCertificate, disableSSL, getSetting, setSetting } from '../services/ssl';

export function registerSSLRoutes(app: FastifyInstance) {
  // ─── GET /api/admin/ssl — get current SSL status ─────────────
  app.get('/api/admin/ssl', async (request, reply) => {
    try {
      const status = getSSLStatus();
      return status;
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ─── POST /api/admin/ssl — save SSL settings ─────────────────
  app.post('/api/admin/ssl', async (request, reply) => {
    try {
      const { domain, email } = request.body as { domain: string; email: string };

      if (!domain || !domain.trim()) {
        return reply.code(400).send({ error: 'Domain is required' });
      }
      if (!email || !email.trim()) {
        return reply.code(400).send({ error: 'Email is required for Let\'s Encrypt' });
      }

      // Basic domain validation
      const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
      if (!domainRegex.test(domain.trim())) {
        return reply.code(400).send({ error: 'Invalid domain format' });
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return reply.code(400).send({ error: 'Invalid email format' });
      }

      setSetting('ssl_domain', domain.trim());
      setSetting('ssl_email', email.trim());

      return { success: true, message: 'SSL settings saved', domain: domain.trim(), email: email.trim() };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ─── POST /api/admin/ssl/apply — request certificate ─────────
  app.post('/api/admin/ssl/apply', async (request, reply) => {
    try {
      const domain = getSetting('ssl_domain');
      const email = getSetting('ssl_email');

      if (!domain) {
        return reply.code(400).send({ error: 'Domain not configured. Save SSL settings first.' });
      }
      if (!email) {
        return reply.code(400).send({ error: 'Email not configured. Save SSL settings first.' });
      }

      // Allow body to override saved settings
      const body = (request.body || {}) as { domain?: string; email?: string };
      const finalDomain = body.domain?.trim() || domain;
      const finalEmail = body.email?.trim() || email;

      const result = await requestCertificate(finalDomain, finalEmail);

      if (result.success) {
        return { success: true, message: result.message };
      } else {
        return reply.code(500).send({ success: false, error: result.message });
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ─── POST /api/admin/ssl/disable — disable SSL ───────────────
  app.post('/api/admin/ssl/disable', async (request, reply) => {
    try {
      const result = disableSSL();
      if (result.success) {
        return { success: true, message: result.message };
      } else {
        return reply.code(500).send({ success: false, error: result.message });
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });
}
