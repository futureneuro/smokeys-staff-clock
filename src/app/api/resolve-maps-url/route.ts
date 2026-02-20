import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const { url } = await req.json();
        if (!url || typeof url !== 'string') {
            return NextResponse.json({ error: 'Missing url' }, { status: 400 });
        }

        // Only allow Google Maps shortened URLs
        if (
            !url.includes('maps.app.goo.gl') &&
            !url.includes('goo.gl/maps')
        ) {
            return NextResponse.json({ error: 'Not a shortened Google Maps URL' }, { status: 400 });
        }

        // Follow redirects manually to get the final URL
        const response = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
        });

        const resolvedUrl = response.url;

        return NextResponse.json({ resolvedUrl });
    } catch {
        return NextResponse.json({ error: 'Failed to resolve URL' }, { status: 500 });
    }
}
