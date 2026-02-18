import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

// Augment FastifyInstance with authenticate decorator
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// Augment @fastify/jwt user payload type
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      username: string;
      role: string;
      type?: string;
    };
    user: {
      sub: string;
      username: string;
      role: string;
      type?: string;
      iat: number;
      exp: number;
    };
  }
}

// Routes that are fully public — no JWT required
const PUBLIC_ROUTES = new Set([
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/events',        // SSE — EventSource can't send custom headers
  '/api/system/health', // health check for monitoring
]);

const jwtAuthPlugin: FastifyPluginAsync = async (fastify) => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    const msg = 'JWT_SECRET env var is missing or too short (min 32 chars). Set it before starting.';
    fastify.log.error(msg);
    throw new Error(msg);
  }

  // Register @fastify/jwt
  await fastify.register(jwt, {
    secret: jwtSecret,
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });

  // Register @fastify/rate-limit globally (per-route config overrides via config.rateLimit)
  await fastify.register(rateLimit, {
    global: false, // opt-in per route
    max: 60,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, context) => ({
      error: `Rate limit exceeded. Retry after ${Math.ceil(context.ttl / 1000)}s.`,
    }),
  });

  // Decorate fastify with `authenticate` hook used in protected routes
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err: any) {
      fastify.log.debug({ err, url: request.url }, 'JWT verification failed');
      reply.code(401).send({ error: 'Unauthorized — invalid or expired token' });
    }
  });

  // Global onRequest hook: protect all /api/* routes except public ones
  fastify.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0]; // strip query string

    // Not an API route — skip (static files, frontend)
    if (!url.startsWith('/api/')) return;

    // Public routes — skip
    if (PUBLIC_ROUTES.has(url)) return;

    // All other /api/* routes require a valid token
    try {
      await request.jwtVerify();
    } catch (err: any) {
      fastify.log.debug({ url, err: err.message }, 'Unauthorized API request');
      reply.code(401).send({ error: 'Unauthorized — please log in' });
    }
  });
};

export default fp(jwtAuthPlugin, {
  name: 'jwt-auth',
  fastify: '4.x',
});
