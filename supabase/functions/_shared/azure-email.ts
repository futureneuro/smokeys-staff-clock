// Azure Communication Services email.
//
// Same HMAC-SHA256 signing scheme as azure-sms.ts, different path. The helpers
// there are not exported, and that file belongs to the attendance feature, so
// they are repeated here rather than refactoring a working feature to share
// them.
//
// Sending needs an Email Communication Service resource with a verified sender
// domain attached to the same ACS resource the SMS already uses.

const textEncoder = new TextEncoder();

function toBase64(bytes: ArrayBuffer): string {
  let binary = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.byteLength; i += 1) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

async function hmacSha256Base64(secretB64: string, message: string): Promise<string> {
  const rawKey = Uint8Array.from(atob(secretB64), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, textEncoder.encode(message));
  return toBase64(signature);
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
}

export interface SendEmailArgs {
  endpoint: string;
  accessKey: string;
  /** Must be an address on a domain verified in the ACS Email resource. */
  sender: string;
  recipients: string[];
  subject: string;
  html: string;
  plainText: string;
}

export interface SendEmailResult {
  ok: boolean;
  status: number;
  body: unknown;
}

export async function sendAcsEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const endpoint = normalizeEndpoint(args.endpoint);
  const path = '/emails:send?api-version=2023-03-31';
  const method = 'POST';
  const date = new Date().toUTCString();
  const host = new URL(endpoint).host;

  const body = JSON.stringify({
    senderAddress: args.sender,
    recipients: { to: args.recipients.map(address => ({ address })) },
    content: {
      subject: args.subject,
      plainText: args.plainText,
      html: args.html,
    },
  });

  const bodyHashBuf = await crypto.subtle.digest('SHA-256', textEncoder.encode(body));
  const contentHash = toBase64(bodyHashBuf);
  const stringToSign = [method, path, date, host, contentHash].join('\n');
  const signature = await hmacSha256Base64(args.accessKey, stringToSign);
  const authorization =
    `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`;

  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-ms-date': date,
      'x-ms-content-sha256': contentHash,
      Authorization: authorization,
    },
    body,
  });

  // Read the body once as text, then try to parse it. Calling json() first and
  // falling back to text() throws "Body already consumed" and hides the real
  // status behind a misleading error.
  let parsed: unknown;
  const raw = await response.text().catch(() => '');
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw.slice(0, 500);
  }

  return { ok: response.ok, status: response.status, body: parsed };
}
