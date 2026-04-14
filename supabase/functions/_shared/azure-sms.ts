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

export interface SendSmsArgs {
    endpoint: string;
    accessKey: string;
    sender: string;
    recipient: string;
    message: string;
}

export async function sendAcsSms(args: SendSmsArgs): Promise<{ ok: boolean; body: unknown; status: number }> {
    const endpoint = normalizeEndpoint(args.endpoint);
    const path = '/sms?api-version=2023-03-31';
    const method = 'POST';
    const date = new Date().toUTCString();
    const host = new URL(endpoint).host;
    const body = JSON.stringify({
        from: args.sender,
        smsRecipients: [{ to: args.recipient }],
        message: args.message,
    });

    const bodyHashBuf = await crypto.subtle.digest('SHA-256', textEncoder.encode(body));
    const contentHash = toBase64(bodyHashBuf);
    const stringToSign = [method, path, date, host, contentHash].join('\n');
    const signature = await hmacSha256Base64(args.accessKey, stringToSign);
    const authorization = `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`;

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

    let parsed: unknown;
    try {
        parsed = await response.json();
    } catch {
        parsed = await response.text();
    }

    return { ok: response.ok, body: parsed, status: response.status };
}
