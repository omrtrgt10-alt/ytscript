/**
 * YTScript - Cloudflare Workers API
 * YouTube Subtitle Extractor
 * 
 * Hybrid Strategy:
 * 1. Try Invidious API (public instances, no IP blocking)
 * 2. Fallback to direct YouTube scraping
 */

// Public Invidious instances that provide API access
const INVIDIOUS_INSTANCES = [
    'https://invidious.io',
    'https://vid.puffyan.us',
    'https://invidious.snopyta.org',
    'https://yewtu.be',
    'https://invidious.kavin.rocks',
    'https://inv.riverside.rocks'
];

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

                // Try multiple strategies
                let result = null;
                let lastError = null;

                // Strategy 1: Invidious API (most reliable, no IP blocking)
                result = await tryInvidiousAPI(videoId);
                if (result) {
                    return jsonResponse(result);
                }

                // Strategy 2: Direct YouTube (may be blocked)
                try {
                    result = await fetchFromYouTube(videoId);
                    if (result) {
                        return jsonResponse(result);
                    }
                } catch (e) {
                    lastError = e;
                }

                throw new Error(lastError?.message || 'Could not extract subtitles');

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

/**
 * Strategy 1: Invidious API
 * Invidious is a YouTube frontend that provides a public API
 * Less likely to be blocked than direct YouTube requests
 */
async function tryInvidiousAPI(videoId) {
    for (const instance of INVIDIOUS_INSTANCES) {
        try {
            // Get video captions from Invidious API
            const captionsUrl = `${instance}/api/v1/captions/${videoId}`;
            const response = await fetch(captionsUrl, {
                headers: { 'Accept': 'application/json' },
                cf: { cacheTtl: 300 } // Cache for 5 minutes
            });

            if (!response.ok) continue;

            const data = await response.json();

            if (!data.captions || data.captions.length === 0) {
                continue;
            }

            // Get the first available caption track
            const caption = data.captions.find(c => !c.label.includes('auto')) || data.captions[0];
            const language = caption.label || 'Unknown';

            // Fetch the actual caption content
            const captionContentUrl = `${instance}${caption.url}`;
            const captionResponse = await fetch(captionContentUrl);

            if (!captionResponse.ok) continue;

            const captionVtt = await captionResponse.text();
            const subtitles = parseVTT(captionVtt);

            if (subtitles.length > 0) {
                return {
                    success: true,
                    videoId,
                    language,
                    subtitles,
                    source: 'invidious'
                };
            }
        } catch (e) {
            console.log(`Invidious instance ${instance} failed:`, e.message);
            continue;
        }
    }
    return null;
}

/**
 * Parse WebVTT format captions
 */
function parseVTT(vttContent) {
    const subtitles = [];
    const lines = vttContent.split('\n');

    let currentStart = 0;
    let currentEnd = 0;
    let currentText = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Check for timestamp line (00:00:00.000 --> 00:00:00.000)
        const timestampMatch = line.match(/(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/);

        if (timestampMatch) {
            // Save previous subtitle if exists
            if (currentText) {
                subtitles.push({
                    start: currentStart,
                    dur: currentEnd - currentStart,
                    text: currentText.trim()
                });
            }

            currentStart = parseVTTTime(timestampMatch[1]);
            currentEnd = parseVTTTime(timestampMatch[2]);
            currentText = '';
        } else if (line && !line.startsWith('WEBVTT') && !line.match(/^\d+$/)) {
            // Text line (not header, not cue number)
            if (currentText) currentText += ' ';
            currentText += line.replace(/<[^>]+>/g, ''); // Remove VTT tags
        }
    }

    // Add last subtitle
    if (currentText) {
        subtitles.push({
            start: currentStart,
            dur: currentEnd - currentStart,
            text: currentText.trim()
        });
    }

    return subtitles;
}

/**
 * Parse VTT timestamp to seconds
 */
function parseVTTTime(timeStr) {
    const parts = timeStr.replace(',', '.').split(':');
    if (parts.length === 3) {
        return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    }
    return 0;
}

/**
 * Strategy 2: Direct YouTube scraping (fallback)
 */
async function fetchFromYouTube(videoId) {
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
        throw new Error('Could not parse video data');
    }

    let playerResponse;
    try {
        let jsonStr = playerResponseMatch[1];
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
        throw new Error('No subtitles available');
    }

    const selectedTrack = captionTracks.find(t => t.kind !== 'asr') || captionTracks[0];
    const captionUrl = selectedTrack.baseUrl;
    const language = selectedTrack.name?.simpleText || selectedTrack.languageCode || 'Unknown';

    const captionResponse = await fetch(captionUrl);
    if (!captionResponse.ok) {
        throw new Error('Failed to fetch captions');
    }

    const captionXml = await captionResponse.text();
    const subtitles = parseXMLCaptions(captionXml);

    if (subtitles.length === 0) {
        throw new Error('Could not parse captions');
    }

    return {
        success: true,
        videoId,
        language,
        subtitles,
        source: 'youtube'
    };
}

/**
 * Parse YouTube XML caption format
 */
function parseXMLCaptions(xml) {
    const subtitles = [];
    const textRegex = /<text\s+start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/text>/g;
    let match;

    while ((match = textRegex.exec(xml)) !== null) {
        const start = parseFloat(match[1]);
        const dur = parseFloat(match[2] || '0');
        let text = match[3]
            .replace(/<[^>]+>/g, '')
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

    return subtitles;
}
