/**
 * Telegram Bot notification service
 * Sends error alerts and test messages via Telegram Bot API
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

// Rate-limit: max 1 message per station per 60 seconds to avoid spam
const lastSent = new Map<string, number>();
const RATE_LIMIT_MS = 60_000;

interface TelegramResult {
  ok: boolean;
  description?: string;
}

/**
 * Send a raw message to a Telegram chat
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'Markdown' = 'HTML'
): Promise<TelegramResult> {
  if (!botToken || !chatId) {
    return { ok: false, description: 'Bot token or chat ID is missing' };
  }

  try {
    const url = `${TELEGRAM_API}${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });

    const data = await res.json() as any;
    if (!data.ok) {
      return { ok: false, description: data.description || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, description: err.message || 'Network error' };
  }
}

/**
 * Send an error notification (rate-limited per station)
 */
export async function sendTelegramError(
  botToken: string,
  chatId: string,
  stationName: string,
  stationId: string,
  level: string,
  source: string,
  message: string
): Promise<TelegramResult> {
  // Rate limiting
  const key = stationId;
  const now = Date.now();
  const last = lastSent.get(key) || 0;
  if (now - last < RATE_LIMIT_MS) {
    return { ok: true, description: 'Rate-limited (skipped)' };
  }
  lastSent.set(key, now);

  const emoji = level === 'error' ? '🔴' : level === 'warn' ? '🟡' : 'ℹ️';
  const time = new Date().toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' });
  const text = [
    `${emoji} <b>RadioStream Alert</b>`,
    ``,
    `<b>Station:</b> ${escapeHtml(stationName)}`,
    `<b>Level:</b> ${level.toUpperCase()}`,
    `<b>Source:</b> ${source}`,
    `<b>Time:</b> ${time}`,
    ``,
    `<code>${escapeHtml(message.slice(0, 500))}</code>`,
  ].join('\n');

  return sendTelegramMessage(botToken, chatId, text, 'HTML');
}

/**
 * Send a test message to verify bot configuration
 */
export async function sendTelegramTest(
  botToken: string,
  chatId: string,
  stationName: string
): Promise<TelegramResult> {
  const time = new Date().toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' });
  const text = [
    `✅ <b>RadioStream Test Message</b>`,
    ``,
    `Bot connection is working!`,
    `<b>Station:</b> ${escapeHtml(stationName)}`,
    `<b>Time:</b> ${time}`,
    ``,
    `You will receive error notifications for this station here.`,
  ].join('\n');

  return sendTelegramMessage(botToken, chatId, text, 'HTML');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
