/**
 * YTScript - Cloudflare Workers API
 * YouTube Subtitle Extractor
 */

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders() });
        }

        // API endpoint: POST /api/extract
        if (url.pathname === '/api/extract' && request.method === 'POST') {
            try {
                const body = await request.json();
                const videoUrl = body.url;

                if (!videoUrl) {
                    return jsonResponse({ error: 'YouTube URL is required' }, 400);
                }

                const videoId = extractVideoId(videoUrl);

                if (!videoId) {
                    return jsonResponse({ error: 'Invalid YouTube URL' }, 400);
                }

                const result = await fetchTranscript(videoId);
                return jsonResponse(result);

            } catch (error) {
                console.error('API Error:', error);
                return jsonResponse({ error: error.message || 'Failed to extract subtitles' }, 500);
            }
        }

        // For all other requests, serve from assets (static files)
        return env.ASSETS.fetch(request);
    }
};

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders()
        }
    });
}

function extractVideoId(url) {
    if (!url) return null;

    let match = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];

    match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];

    match = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];

    match = url.match(/youtube\.com\/v\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];

    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;

    return null;
}

async function fetchTranscript(videoId) {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const response = await fetch(watchUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    });

    if (!response.ok) {
        throw new Error('Failed to fetch video page');
    }

    const html = await response.text();

    // Try multiple patterns to find player response
    let playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});\s*(?:var|const|let|<\/script>)/);
    if (!playerResponseMatch) {
        playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
    }

    if (!playerResponseMatch) {
        throw new Error('Could not parse video data. Video may be private or unavailable.');
    }

    let playerResponse;
    try {
        let jsonStr = playerResponseMatch[1];
        // Balance braces to find complete JSON
        let braceCount = 0;
        let endIndex = jsonStr.length;
        for (let i = 0; i < jsonStr.length; i++) {
            if (jsonStr[i] === '{') braceCount++;
            else if (jsonStr[i] === '}') braceCount--;
            if (braceCount === 0 && i > 0) {
                endIndex = i + 1;
                break;
            }
        }
        jsonStr = jsonStr.substring(0, endIndex);
        playerResponse = JSON.parse(jsonStr);
    } catch (e) {
        throw new Error('Failed to parse video metadata');
    }

    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captionTracks || captionTracks.length === 0) {
        throw new Error('No subtitles available for this video');
    }

    // Prefer manual captions over auto-generated
    const selectedTrack = captionTracks.find(t => t.kind !== 'asr') || captionTracks[0];
    let captionUrl = selectedTrack.baseUrl;
    const language = selectedTrack.name?.simpleText || selectedTrack.languageCode || 'Unknown';

    // Fetch captions (default XML format is more reliable)
    const captionResponse = await fetch(captionUrl);
    if (!captionResponse.ok) {
        throw new Error('Failed to fetch captions');
    }

    const captionData = await captionResponse.text();
    let subtitles = [];

    // Parse XML caption data
    // Format: <text start="0.5" dur="2.5">Hello world</text>
    const textRegex = /<text\s+start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/text>/g;
    let match;

    while ((match = textRegex.exec(captionData)) !== null) {
        const start = parseFloat(match[1]);
        const dur = parseFloat(match[2] || '0');
        // Clean up text - remove HTML tags and decode entities
        let text = match[3]
            .replace(/<[^>]+>/g, '') // Remove any HTML tags
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&apos;/g, "'")
            .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(parseInt(code)))
            .replace(/\n/g, ' ')
            .trim();

        if (text) {
            subtitles.push({ start, dur, text });
        }
    }

    // If XML parsing failed, try JSON format
    if (subtitles.length === 0) {
        try {
            // Refetch with JSON format
            const jsonUrl = captionUrl + (captionUrl.includes('?') ? '&' : '?') + 'fmt=json3';
            const jsonResponse = await fetch(jsonUrl);
            if (jsonResponse.ok) {
                const jsonData = await jsonResponse.json();
                if (jsonData.events) {
                    for (const event of jsonData.events) {
                        if (event.segs) {
                            const text = event.segs.map(seg => seg.utf8 || '').join('').trim();
                            if (text && text !== '\n') {
                                subtitles.push({
                                    start: (event.tStartMs || 0) / 1000,
                                    dur: (event.dDurationMs || 0) / 1000,
                                    text: text.replace(/\n/g, ' ').trim()
                                });
                            }
                        }
                    }
                }
            }
        } catch (e) {
            // JSON parsing also failed
        }
    }

    if (subtitles.length === 0) {
        throw new Error('Could not parse captions. The video may have restricted captions.');
    }

    return {
        success: true,
        videoId,
        language,
        subtitles
    };
}
