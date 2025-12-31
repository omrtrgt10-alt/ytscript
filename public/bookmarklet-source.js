/**
 * YTScript Bookmarklet
 * Extracts YouTube subtitles from the current page and sends to YTScript
 * 
 * This code runs directly in the user's browser on YouTube pages.
 * No server needed, no IP blocking issues!
 */

(function () {
    // Configuration
    const YTSCRIPT_URL = 'https://ytscript.pages.dev'; // Change to your actual URL

    // Check if on YouTube
    if (!window.location.hostname.includes('youtube.com')) {
        alert('Please use this on a YouTube video page!');
        return;
    }

    // Get video ID
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v');

    if (!videoId) {
        alert('Could not find video ID. Please use this on a YouTube video page (youtube.com/watch?v=...)');
        return;
    }

    // Find ytInitialPlayerResponse in page
    let playerResponse = null;

    // Method 1: Try window object
    if (window.ytInitialPlayerResponse) {
        playerResponse = window.ytInitialPlayerResponse;
    }

    // Method 2: Extract from page scripts
    if (!playerResponse) {
        const scripts = document.getElementsByTagName('script');
        for (const script of scripts) {
            const text = script.textContent;
            const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/);
            if (match) {
                try {
                    // Balance braces
                    let jsonStr = match[1];
                    let braceCount = 0, endIdx = jsonStr.length;
                    for (let i = 0; i < jsonStr.length; i++) {
                        if (jsonStr[i] === '{') braceCount++;
                        else if (jsonStr[i] === '}') braceCount--;
                        if (braceCount === 0 && i > 0) { endIdx = i + 1; break; }
                    }
                    playerResponse = JSON.parse(jsonStr.substring(0, endIdx));
                    break;
                } catch (e) { }
            }
        }
    }

    if (!playerResponse) {
        alert('Could not extract video data. Try refreshing the page and try again.');
        return;
    }

    // Get caption tracks
    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captionTracks || captionTracks.length === 0) {
        alert('No subtitles available for this video.');
        return;
    }

    // Get first available track (prefer manual over auto-generated)
    const track = captionTracks.find(t => t.kind !== 'asr') || captionTracks[0];
    const captionUrl = track.baseUrl;
    const language = track.name?.simpleText || track.languageCode || 'Unknown';
    const title = playerResponse?.videoDetails?.title || 'Unknown';

    // Show loading indicator
    const loadingDiv = document.createElement('div');
    loadingDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:999999;color:white;font-size:24px;font-family:sans-serif;';
    loadingDiv.innerHTML = '⏳ Extracting subtitles...';
    document.body.appendChild(loadingDiv);

    // Fetch captions
    fetch(captionUrl)
        .then(res => res.text())
        .then(xml => {
            // Parse XML captions
            const subtitles = [];
            const regex = /<text start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/text>/g;
            let match;

            while ((match = regex.exec(xml)) !== null) {
                const text = match[3]
                    .replace(/<[^>]+>/g, '')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/&#(\d+);/g, (m, c) => String.fromCharCode(parseInt(c)))
                    .replace(/\n/g, ' ')
                    .trim();

                if (text) {
                    subtitles.push({
                        start: parseFloat(match[1]),
                        dur: parseFloat(match[2] || '0'),
                        text
                    });
                }
            }

            if (subtitles.length === 0) {
                document.body.removeChild(loadingDiv);
                alert('Could not parse captions.');
                return;
            }

            // Create data object
            const data = {
                videoId,
                title,
                language,
                subtitles,
                timestamp: Date.now()
            };

            // Encode and send to YTScript
            const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(data))));

            // Remove loading
            document.body.removeChild(loadingDiv);

            // Open YTScript with data
            window.open(`${YTSCRIPT_URL}?bookmarklet=1&data=${encodedData}`, '_blank');
        })
        .catch(err => {
            document.body.removeChild(loadingDiv);
            alert('Error fetching captions: ' + err.message);
        });
})();
