import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/schema';

interface LoginBody {
  username: string;
  password: string;
}

interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export async function authRoutes(fastify: FastifyInstance) {
  // POST /api/auth/login — public, rate-limited by @fastify/rate-limit
  fastify.post<{ Body: LoginBody }>('/api/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 64 },
          password: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
    },
  }, async (request, reply) => {
    const { username, password } = request.body;
    const db = getDb();
    const ip = request.ip;

    const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) as any;

    // Generic error — never reveal which field is wrong
    const invalidReply = () => reply.code(401).send({ error: 'Invalid credentials' });

    if (!user || !user.is_active) return invalidReply();

    // Check lockout
    if (user.locked_until) {
      const lockedUntil = new Date(user.locked_until);
      if (lockedUntil > new Date()) {
        const remainMin = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000);
        return reply.code(429).send({
          error: `Account locked. Try again in ${remainMin} minute(s).`,
        });
      } else {
        // Lockout expired — reset
        db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
        user.failed_attempts = 0;
        user.locked_until = null;
      }
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      const newFailures = user.failed_attempts + 1;
      if (newFailures >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
        db.prepare(
          'UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?'
        ).run(newFailures, lockUntil, user.id);
        fastify.log.warn({ ip, username }, `Account locked after ${newFailures} failed attempts`);
        return reply.code(429).send({
          error: `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`,
        });
      } else {
        db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(newFailures, user.id);
        fastify.log.warn({ ip, username, attempts: newFailures }, 'Failed login attempt');
        return invalidReply();
      }
    }

    // Success — reset failures, record login
    db.prepare(
      "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = datetime('now'), last_ip = ? WHERE id = ?"
    ).run(ip, user.id);

    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
    };

    const token = fastify.jwt.sign(payload, { expiresIn: '8h' });
    const refreshToken = fastify.jwt.sign(
      { sub: user.id, username: user.username, role: user.role, type: 'refresh' },
      { expiresIn: '7d' }
    );

    fastify.log.info({ ip, username: user.username }, 'Successful login');

    return reply.send({
      token,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        lastLogin: user.last_login,
      },
    });
  });

  // POST /api/auth/refresh — exchange refresh token for new access token
  fastify.post('/api/auth/refresh', {
    config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: { refreshToken: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string };
    try {
      const decoded = fastify.jwt.verify(refreshToken) as any;
      if (decoded.type !== 'refresh') throw new Error('Not a refresh token');

      const db = getDb();
      const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(decoded.sub) as any;
      if (!user) return reply.code(401).send({ error: 'User not found' });

      const newToken = fastify.jwt.sign(
        { sub: user.id, username: user.username, role: user.role },
        { expiresIn: '8h' }
      );

      return reply.send({ token: newToken });
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired refresh token' });
    }
  });

  // GET /api/auth/me — protected
  fastify.get('/api/auth/me', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const db = getDb();
    const dbUser = db.prepare('SELECT id, username, role, last_login, created_at FROM users WHERE id = ?').get(user.sub) as any;
    if (!dbUser) return reply.code(404).send({ error: 'User not found' });
    return reply.send(dbUser);
  });

  // POST /api/auth/change-password — protected
  fastify.post<{ Body: ChangePasswordBody }>('/api/auth/change-password', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', minLength: 1 },
          newPassword: { type: 'string', minLength: 8, maxLength: 128 },
        },
      },
    },
  }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body;
    const authUser = (request as any).user;
    const db = getDb();

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(authUser.sub) as any;
    if (!user) return reply.code(404).send({ error: 'User not found' });

    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) return reply.code(401).send({ error: 'Current password is incorrect' });

    const newHash = await bcrypt.hash(newPassword, 12);
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(newHash, user.id);

    fastify.log.info({ username: user.username }, 'Password changed');
    return reply.send({ message: 'Password updated successfully' });
  });

  // POST /api/auth/users — admin only: create new user
  fastify.post<{ Body: { username: string; password: string; role?: string } }>('/api/auth/users', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 3, maxLength: 32 },
          password: { type: 'string', minLength: 8, maxLength: 128 },
          role: { type: 'string', enum: ['admin', 'viewer'] },
        },
      },
    },
  }, async (request, reply) => {
    const authUser = (request as any).user;
    if (authUser.role !== 'admin') return reply.code(403).send({ error: 'Admin access required' });

    const { username, password, role = 'admin' } = request.body;
    const db = getDb();

    const exists = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (exists) return reply.code(409).send({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)").run(id, username, hash, role);

    return reply.code(201).send({ id, username, role });
  });

  // GET /api/auth/users — admin only: list users
  fastify.get('/api/auth/users', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const authUser = (request as any).user;
    if (authUser.role !== 'admin') return reply.code(403).send({ error: 'Admin access required' });

    const db = getDb();
    const users = db.prepare(
      'SELECT id, username, role, is_active, failed_attempts, locked_until, last_login, last_ip, created_at FROM users ORDER BY created_at'
    ).all();

    return reply.send(users);
  });

  // DELETE /api/auth/users/:id — admin only
  fastify.delete<{ Params: { id: string } }>('/api/auth/users/:id', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const authUser = (request as any).user;
    if (authUser.role !== 'admin') return reply.code(403).send({ error: 'Admin access required' });
    if (authUser.sub === request.params.id) return reply.code(400).send({ error: 'Cannot delete yourself' });

    const db = getDb();
    db.prepare('DELETE FROM users WHERE id = ?').run(request.params.id);
    return reply.send({ message: 'User deleted' });
  });

  // POST /api/auth/users/:id/unlock — admin only
  fastify.post<{ Params: { id: string } }>('/api/auth/users/:id/unlock', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const authUser = (request as any).user;
    if (authUser.role !== 'admin') return reply.code(403).send({ error: 'Admin access required' });

    const db = getDb();
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(request.params.id);
    return reply.send({ message: 'User unlocked' });
  });
}
