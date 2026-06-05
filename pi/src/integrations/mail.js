import { ImapFlow } from 'imapflow';

let state = { unread: 0, recent: [] };
let pollingTimer = null;

// --- Fetch ---

async function fetchMail() {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT) || 993,
    secure: true,
    auth: {
      user: process.env.IMAP_USER,
      pass: process.env.IMAP_PASS,
    },
    logger: false,
  });

  try {
    await client.connect();

    const status = await client.status('INBOX', { unseen: true });
    const unread = status.unseen || 0;
    const recent = [];

    if (unread > 0) {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const messages = [];
        for await (const msg of client.fetch(
          { seen: false },
          { envelope: true },
          { uid: true }
        )) {
          messages.push(msg);
        }

        const newest = messages.slice(-5);
        for (const msg of newest) {
          const env = msg.envelope;
          const from =
            env.from && env.from[0]
              ? env.from[0].name || env.from[0].address
              : 'unknown';
          recent.push({
            subject: env.subject || '(no subject)',
            from,
            date: env.date ? env.date.toISOString() : null,
          });
        }
        recent.reverse();
      } finally {
        lock.release();
      }
    }

    state = { unread, recent };
    console.log(`[mail] refreshed: ${unread} unread`);
  } catch (err) {
    console.error('[mail] fetch error:', err.message);
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore logout errors
    }
  }
}

// --- Public API ---

export function getMailState() {
  return state;
}

export function isConnected() {
  return !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASS);
}

export function startPolling(intervalMs = 30000) {
  if (pollingTimer) return;
  fetchMail();
  pollingTimer = setInterval(fetchMail, intervalMs);
  console.log(`[mail] polling started (${intervalMs}ms)`);
}

export function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    console.log('[mail] polling stopped');
  }
}
