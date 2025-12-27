/**
 * YTScript - Cloudflare Pages Function
 * POST /api/extract - Extract YouTube subtitles
 */

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
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

// Handle CORS preflight
export async function onRequestOptions() {
    return new Response(null, {
        headers: corsHeaders()
    });
}

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

    // youtu.be format
    let match = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];

    // youtube.com/watch?v= format
    match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];

    // youtube.com/embed/ format
    match = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];

    // youtube.com/v/ format
    match = url.match(/youtube\.com\/v\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];

    // Just video ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;

    return null;
}

async function fetchTranscript(videoId) {
    // Fetch YouTube video page
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

    // Extract ytInitialPlayerResponse
    const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);

    if (!playerResponseMatch) {
        throw new Error('Could not parse video data. Video may be private or unavailable.');
    }

    let playerResponse;
    try {
        // Clean up JSON - find the complete object
        let jsonStr = playerResponseMatch[1];
        // Balance braces to find complete JSON
        let braceCount = 0;
        let endIndex = 0;
        for (let i = 0; i < jsonStr.length; i++) {
            if (jsonStr[i] === '{') braceCount++;
            else if (jsonStr[i] === '}') braceCount--;
            if (braceCount === 0) {
                endIndex = i + 1;
                break;
            }
        }
        jsonStr = jsonStr.substring(0, endIndex);
        playerResponse = JSON.parse(jsonStr);
    } catch (e) {
        throw new Error('Failed to parse video metadata');
    }

    // Get caption tracks
    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captionTracks || captionTracks.length === 0) {
        throw new Error('No subtitles available for this video');
    }

    // Get first available caption track (prefer manual over auto-generated)
    const selectedTrack = captionTracks.find(t => t.kind !== 'asr') || captionTracks[0];
    let captionUrl = selectedTrack.baseUrl;
    const language = selectedTrack.name?.simpleText || selectedTrack.languageCode || 'Unknown';

    // Request JSON format
    if (!captionUrl.includes('fmt=')) {
        captionUrl += '&fmt=json3';
    }

    // Fetch captions
    const captionResponse = await fetch(captionUrl);
    if (!captionResponse.ok) {
        throw new Error('Failed to fetch captions');
    }

    const captionData = await captionResponse.text();

    // Parse captions
    let subtitles = [];

    try {
        // Try JSON format
        const jsonData = JSON.parse(captionData);
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
    } catch (e) {
        // Try XML format
        const textMatches = captionData.matchAll(/<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([^<]*)<\/text>/g);
        for (const match of textMatches) {
            const text = decodeHTMLEntities(match[3]).trim();
            if (text) {
                subtitles.push({
                    start: parseFloat(match[1]),
                    dur: parseFloat(match[2]),
                    text
                });
            }
        }
    }

    if (subtitles.length === 0) {
        throw new Error('Could not parse captions');
    }

    return {
        success: true,
        videoId,
        language,
        subtitles
    };
}

function decodeHTMLEntities(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
}
