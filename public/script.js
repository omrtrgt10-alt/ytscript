/**
 * YTScript - YouTube Subtitle Extractor
 * Enhanced frontend with theme toggle, multiple exports, and history
 */

// ==================== 
// DOM Elements
// ====================
const urlInput = document.getElementById('urlInput');
const extractBtn = document.getElementById('extractBtn');
const errorMessage = document.getElementById('errorMessage');
const resultsSection = document.getElementById('resultsSection');
const subtitlesContainer = document.getElementById('subtitlesContainer');
const emptyState = document.getElementById('emptyState');
const videoIdBadge = document.getElementById('videoIdBadge');
const languageBadge = document.getElementById('languageBadge');
const subtitleCount = document.getElementById('subtitleCount');
const showTimestamps = document.getElementById('showTimestamps');
const copyBtn = document.getElementById('copyBtn');
const downloadTxt = document.getElementById('downloadTxt');
const downloadSrt = document.getElementById('downloadSrt');
const downloadVtt = document.getElementById('downloadVtt');
const downloadJson = document.getElementById('downloadJson');
const themeToggle = document.getElementById('themeToggle');
const toast = document.getElementById('toast');
const cookieConsent = document.getElementById('cookieConsent');
const acceptCookies = document.getElementById('acceptCookies');
const historySection = document.getElementById('historySection');
const historyList = document.getElementById('historyList');
const clearHistory = document.getElementById('clearHistory');

// ==================== 
// State
// ====================
let currentSubtitles = [];
let currentVideoId = '';
let currentLanguage = '';

// ==================== 
// Rate Limiting Config
// ====================
const RATE_LIMIT = 5;        // Max extractions
const RATE_WINDOW = 60 * 60 * 1000;  // 1 hour in ms

// ==================== 
// Initialize
// ====================
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initCookieConsent();
    loadHistory();

    // Event listeners
    extractBtn.addEventListener('click', handleExtract);
    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleExtract();
    });

    showTimestamps.addEventListener('change', toggleTimestamps);
    copyBtn.addEventListener('click', handleCopy);
    downloadTxt.addEventListener('click', () => handleDownload('txt'));
    downloadSrt.addEventListener('click', () => handleDownload('srt'));
    downloadVtt.addEventListener('click', () => handleDownload('vtt'));
    downloadJson.addEventListener('click', () => handleDownload('json'));
    document.getElementById('downloadDocx')?.addEventListener('click', () => handleDownloadDocx());
    document.getElementById('downloadPdf')?.addEventListener('click', () => handleDownloadPdf());
    themeToggle.addEventListener('click', toggleTheme);
    acceptCookies?.addEventListener('click', acceptCookieConsent);
    clearHistory?.addEventListener('click', clearAllHistory);

    urlInput.focus();

    // Auto-detect YouTube URL from clipboard
    checkClipboardForYouTubeUrl();
});

// ==================== 
// Clipboard Auto-Paste
// ====================
async function checkClipboardForYouTubeUrl() {
    // Only check if input is empty
    if (urlInput.value.trim()) return;

    try {
        // Check if clipboard API is available and user granted permission
        if (!navigator.clipboard || !navigator.clipboard.readText) return;

        const clipboardText = await navigator.clipboard.readText();

        if (clipboardText && isValidYouTubeUrl(clipboardText)) {
            urlInput.value = clipboardText;
            urlInput.classList.add('auto-filled');
            showToast('📋 YouTube URL detected from clipboard!', 'success');

            // Remove highlight after 2 seconds
            setTimeout(() => {
                urlInput.classList.remove('auto-filled');
            }, 2000);

            trackEvent('clipboard_auto_paste', { detected: true });
        }
    } catch (err) {
        // Clipboard permission denied or other error - silently ignore
        console.log('Clipboard access not available');
    }
}

// Also check when window regains focus
window.addEventListener('focus', () => {
    if (!urlInput.value.trim()) {
        checkClipboardForYouTubeUrl();
    }
});

// ==================== 
// Theme Management
// ====================
function initTheme() {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
}

// ==================== 
// Cookie Consent (GDPR)
// ====================
const CONSENT_KEY = 'ytscript_consent';
const CONSENT_EXPIRY = 365 * 24 * 60 * 60 * 1000; // 1 year

function initCookieConsent() {
    const consent = getConsentData();

    // If no consent saved, show banner
    if (!consent) {
        setTimeout(() => {
            cookieConsent?.classList.remove('hidden');
        }, 1000); // Delay for better UX
        return;
    }

    // Apply saved consent
    applyConsent(consent);
}

function getConsentData() {
    try {
        const data = JSON.parse(localStorage.getItem(CONSENT_KEY));
        if (data && Date.now() - data.timestamp < CONSENT_EXPIRY) {
            return data;
        }
        return null;
    } catch {
        return null;
    }
}

function saveConsent(preferences) {
    const data = {
        ...preferences,
        timestamp: Date.now()
    };
    localStorage.setItem(CONSENT_KEY, JSON.stringify(data));
    applyConsent(data);
    cookieConsent?.classList.add('hidden');
}

function applyConsent(consent) {
    // Essential is always enabled

    // Analytics (Google Analytics 4)
    if (consent.analytics) {
        initGoogleAnalytics();
    }

    // Advertising (Google AdSense)
    if (consent.advertising) {
        initGoogleAdsense();
    }
}

// Cookie Consent Event Handlers
document.getElementById('acceptAllCookies')?.addEventListener('click', () => {
    saveConsent({ essential: true, analytics: true, advertising: true });
    trackEvent('cookie_consent', { choice: 'accept_all' });
});

document.getElementById('rejectAllCookies')?.addEventListener('click', () => {
    saveConsent({ essential: true, analytics: false, advertising: false });
});

document.getElementById('customizeCookies')?.addEventListener('click', () => {
    document.getElementById('cookieCustomize')?.classList.toggle('hidden');
});

document.getElementById('saveCookiePrefs')?.addEventListener('click', () => {
    const analyticsChecked = document.getElementById('analyticsConsent')?.checked || false;
    const advertisingChecked = document.getElementById('advertisingConsent')?.checked || false;
    saveConsent({
        essential: true,
        analytics: analyticsChecked,
        advertising: advertisingChecked
    });
    trackEvent('cookie_consent', { choice: 'custom', analytics: analyticsChecked, advertising: advertisingChecked });
});

// ==================== 
// Google Analytics 4
// ====================
const GA_MEASUREMENT_ID = 'G-XXXXXXXXXX'; // Replace with your GA4 ID
let gaInitialized = false;

function initGoogleAnalytics() {
    if (gaInitialized) return;
    gaInitialized = true;

    // Load gtag.js
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    function gtag() { dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID, {
        page_path: window.location.pathname,
        anonymize_ip: true
    });

    console.log('📊 Google Analytics initialized');
}

function trackEvent(eventName, parameters = {}) {
    if (!gaInitialized || typeof gtag === 'undefined') return;

    gtag('event', eventName, {
        ...parameters,
        timestamp: Date.now()
    });
}

// ==================== 
// Google AdSense (Placeholder)
// ====================
function initGoogleAdsense() {
    // AdSense will be initialized when you add your code
    console.log('📢 AdSense consent granted');
}

// ==================== 
// Main Extraction
// ====================

// CORS proxy for fetching YouTube data from browser
// These proxies relay requests to bypass CORS restrictions
const CORS_PROXIES = [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://proxy.cors.sh/${url}`,
    (url) => `https://thingproxy.freeboard.io/fetch/${url}`
];

let currentProxyIndex = 0;
let useServerFallback = false;

async function fetchWithCORS(url) {
    // If server fallback mode is on, skip client-side
    if (useServerFallback) {
        throw new Error('Using server fallback');
    }

    // Try each proxy until one works
    for (let i = 0; i < CORS_PROXIES.length; i++) {
        const proxyIndex = (currentProxyIndex + i) % CORS_PROXIES.length;
        const proxyUrl = CORS_PROXIES[proxyIndex](url);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

            const response = await fetch(proxyUrl, {
                signal: controller.signal,
                headers: {
                    'Accept': '*/*',
                    'Origin': window.location.origin
                }
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                const text = await response.text();
                // Validate we got actual content
                if (text && text.length > 100 && !text.includes('<!DOCTYPE html>')) {
                    currentProxyIndex = proxyIndex;
                    return text;
                }
                // If proxy returned HTML error page, continue to next
                console.warn(`Proxy ${proxyIndex} returned invalid content`);
            }
        } catch (e) {
            console.warn(`Proxy ${proxyIndex} failed:`, e.message);
        }
    }
    throw new Error('All CORS proxies failed');
}

// Server-side fallback function
async function fetchFromServer(url) {
    const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'Server extraction failed');
    }

    return data;
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

async function fetchYouTubeTranscript(videoId) {
    // Step 1: Fetch the video page to get caption track info
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const html = await fetchWithCORS(watchUrl);

    // Step 2: Extract player response JSON - try multiple patterns
    let playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:\s*var|<\/script>)/s);
    if (!playerResponseMatch) {
        playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?"captions".*?\});/s);
    }
    if (!playerResponseMatch) {
        // Try to find it more broadly
        playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});\s*(?:var|const|let|<\/script>)/);
    }

    if (!playerResponseMatch) {
        throw new Error('Could not parse video data. The video may be private, age-restricted, or unavailable.');
    }

    let playerResponse;
    try {
        // Clean up the JSON string
        let jsonStr = playerResponseMatch[1];
        // Sometimes there's trailing content
        const lastBrace = jsonStr.lastIndexOf('}');
        if (lastBrace !== -1) {
            jsonStr = jsonStr.substring(0, lastBrace + 1);
        }
        playerResponse = JSON.parse(jsonStr);
    } catch (e) {
        console.error('JSON parse error:', e);
        throw new Error('Failed to parse video metadata. Please try a different video.');
    }

    // Step 3: Get caption tracks
    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captionTracks || captionTracks.length === 0) {
        throw new Error('No subtitles available for this video. The creator may not have added captions.');
    }

    // Step 4: Get the first available caption track (prefer manual over auto-generated)
    let selectedTrack = captionTracks.find(t => t.kind !== 'asr') || captionTracks[0];
    let captionUrl = selectedTrack.baseUrl;
    const language = selectedTrack.name?.simpleText || selectedTrack.languageCode || 'Unknown';

    // Add format parameter for JSON (easier to parse)
    if (!captionUrl.includes('fmt=')) {
        captionUrl += '&fmt=json3';
    }

    // Step 5: Fetch the caption data
    const captionData = await fetchWithCORS(captionUrl);

    // Step 6: Parse captions - try JSON first, then XML
    let subtitles = [];

    try {
        // Try JSON format first
        const jsonData = JSON.parse(captionData);
        if (jsonData.events) {
            jsonData.events.forEach(event => {
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
            });
        }
    } catch (e) {
        // Not JSON, try XML
        console.log('Trying XML format...');

        // Try DOMParser first
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(captionData, 'text/xml');
        const textElements = xmlDoc.querySelectorAll('text');

        if (textElements.length > 0) {
            textElements.forEach(el => {
                const start = parseFloat(el.getAttribute('start') || '0');
                const dur = parseFloat(el.getAttribute('dur') || '0');
                const text = el.textContent
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/\n/g, ' ')
                    .trim();

                if (text) {
                    subtitles.push({ start, dur, text });
                }
            });
        } else {
            // Fallback: regex parsing
            const regex = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([^<]*)<\/text>/g;
            let match;
            while ((match = regex.exec(captionData)) !== null) {
                const text = match[3]
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .trim();
                if (text) {
                    subtitles.push({
                        start: parseFloat(match[1]),
                        dur: parseFloat(match[2]),
                        text
                    });
                }
            }
        }
    }

    if (subtitles.length === 0) {
        console.error('Caption data sample:', captionData.substring(0, 500));
        throw new Error('Could not parse captions. Please try a different video.');
    }

    return {
        videoId,
        language,
        subtitles
    };
}

async function handleExtract() {
    const url = urlInput.value.trim();

    if (!url) {
        showError('Please enter a YouTube URL');
        return;
    }

    if (!isValidYouTubeUrl(url)) {
        showError('Please enter a valid YouTube URL');
        return;
    }

    // Check rate limit
    const remaining = getRemainingExtractions();
    if (remaining <= 0) {
        const resetTime = getResetTimeString();
        showError(`Hourly limit reached (${RATE_LIMIT}/hour). Resets in ${resetTime}`);
        return;
    }

    hideError();
    setLoading(true);

    let data = null;
    let method = 'unknown';

    try {
        const videoId = extractVideoId(url);

        if (!videoId) {
            throw new Error('Could not extract video ID from URL');
        }

        // Strategy 1: Try client-side extraction first (uses user's IP)
        if (!useServerFallback) {
            try {
                console.log('Trying client-side extraction...');
                data = await fetchYouTubeTranscript(videoId);
                method = 'client_side';
                console.log('Client-side extraction succeeded!');
            } catch (clientError) {
                console.warn('Client-side extraction failed:', clientError.message);
                // Fall through to server-side
            }
        }

        // Strategy 2: Server-side fallback
        if (!data) {
            console.log('Trying server-side extraction...');
            try {
                data = await fetchFromServer(url);
                method = 'server_side';
                console.log('Server-side extraction succeeded!');
            } catch (serverError) {
                console.error('Server-side extraction failed:', serverError.message);
                throw new Error('Unable to extract subtitles. The video may not have captions or may be restricted.');
            }
        }

        currentSubtitles = data.subtitles;
        currentVideoId = data.videoId;
        currentLanguage = data.language;

        displaySubtitles(data);
        saveToHistory(data.videoId, data.language);
        incrementExtractionCount();

        // Track success
        trackEvent('extract_success', { method, video_id: data.videoId });

    } catch (error) {
        console.error('Extraction error:', error);
        showError(error.message);
        trackEvent('extract_error', { error: error.message });
    } finally {
        setLoading(false);
    }
}

function displaySubtitles(data) {
    emptyState.classList.add('hidden');
    resultsSection.classList.remove('hidden');

    videoIdBadge.textContent = data.videoId;
    languageBadge.textContent = data.language || 'Auto';
    subtitleCount.textContent = `${data.subtitles.length} lines`;

    subtitlesContainer.innerHTML = data.subtitles.map(sub => `
        <div class="subtitle-line">
            <span class="subtitle-time">${formatTime(sub.start)}</span>
            <span class="subtitle-text">${escapeHtml(sub.text)}</span>
        </div>
    `).join('');

    // Show share section
    document.getElementById('shareSection')?.classList.remove('hidden');

    toggleTimestamps();
    showToast('Subtitles extracted successfully!', 'success');

    // Track GA event
    trackEvent('extract_completed', {
        video_id: data.videoId,
        language: data.language,
        subtitle_count: data.subtitles.length
    });
}

// ==================== 
// Social Sharing
// ====================
document.getElementById('shareTwitter')?.addEventListener('click', () => {
    const text = `I just extracted subtitles using YTScript! 🎬\n\nTry it free: https://ytscript.com`;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'width=600,height=400');
    trackEvent('share', { platform: 'twitter' });
});

document.getElementById('shareWhatsApp')?.addEventListener('click', () => {
    const text = `Check out YTScript - extract YouTube subtitles instantly! https://ytscript.com`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
    trackEvent('share', { platform: 'whatsapp' });
});

document.getElementById('shareCopy')?.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText('https://ytscript.com');
        showToast('Link copied!', 'success');
        trackEvent('share', { platform: 'copy_link' });
    } catch {
        showToast('Failed to copy', 'error');
    }
});

function toggleTimestamps() {
    if (showTimestamps.checked) {
        subtitlesContainer.classList.remove('no-timestamps');
    } else {
        subtitlesContainer.classList.add('no-timestamps');
    }
}

// ==================== 
// Copy & Download
// ====================
async function handleCopy() {
    const text = showTimestamps.checked ? getTimestampedText() : getPlainText();

    try {
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard!', 'success');
    } catch (error) {
        showToast('Failed to copy', 'error');
    }
}

function handleDownload(format) {
    if (currentSubtitles.length === 0) return;

    let content, filename, mimeType;

    switch (format) {
        case 'txt':
            content = getPlainText();
            filename = `${currentVideoId}_transcript.txt`;
            mimeType = 'text/plain';
            break;
        case 'srt':
            content = getSrtContent();
            filename = `${currentVideoId}_subtitles.srt`;
            mimeType = 'text/srt';
            break;
        case 'vtt':
            content = getVttContent();
            filename = `${currentVideoId}_subtitles.vtt`;
            mimeType = 'text/vtt';
            break;
        case 'json':
            content = getJsonContent();
            filename = `${currentVideoId}_data.json`;
            mimeType = 'application/json';
            break;
    }

    downloadFile(content, filename, mimeType);
    showToast(`Downloaded ${filename}`, 'success');
}

// DOCX Download (Word format)
async function handleDownloadDocx() {
    if (currentSubtitles.length === 0) return;

    try {
        const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;

        // Create document paragraphs
        const paragraphs = [
            new Paragraph({
                text: `YouTube Video Transcript`,
                heading: HeadingLevel.HEADING_1
            }),
            new Paragraph({
                text: `Video ID: ${currentVideoId}`,
                spacing: { after: 200 }
            }),
            new Paragraph({
                text: `Language: ${currentLanguage || 'Auto-detected'}`,
                spacing: { after: 400 }
            }),
            new Paragraph({ text: '' }), // Empty line
        ];

        // Add each subtitle
        currentSubtitles.forEach(sub => {
            if (showTimestamps.checked) {
                paragraphs.push(new Paragraph({
                    children: [
                        new TextRun({ text: `[${formatTime(sub.start)}] `, bold: true, color: '6366F1' }),
                        new TextRun({ text: sub.text })
                    ],
                    spacing: { after: 100 }
                }));
            } else {
                paragraphs.push(new Paragraph({
                    text: sub.text,
                    spacing: { after: 100 }
                }));
            }
        });

        // Create document
        const doc = new Document({
            sections: [{
                properties: {},
                children: paragraphs
            }]
        });

        // Generate and download
        const blob = await Packer.toBlob(doc);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentVideoId}_transcript.docx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(`Downloaded ${currentVideoId}_transcript.docx`, 'success');
    } catch (error) {
        console.error('DOCX generation error:', error);
        showToast('Failed to generate Word document', 'error');
    }
}

// PDF Download
async function handleDownloadPdf() {
    if (currentSubtitles.length === 0) return;

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Page settings
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 20;
        const lineHeight = 7;
        let yPos = margin;
        let pageNum = 1;

        // Helper function to add new page if needed
        function checkNewPage(neededHeight = lineHeight) {
            if (yPos + neededHeight > pageHeight - margin - 10) {
                doc.setFontSize(9);
                doc.setTextColor(150);
                doc.text(`Page ${pageNum} - ytscript.com`, pageWidth / 2, pageHeight - 10, { align: 'center' });
                doc.addPage();
                pageNum++;
                yPos = margin;
                return true;
            }
            return false;
        }

        // Title
        doc.setFontSize(20);
        doc.setTextColor(99, 102, 241);
        doc.text('YTScript - YouTube Transcript', margin, yPos);
        yPos += 12;

        // Metadata
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Video ID: ${currentVideoId}`, margin, yPos);
        yPos += 6;
        doc.text(`Language: ${currentLanguage || 'Auto-detected'}`, margin, yPos);
        yPos += 6;
        doc.text(`Extracted: ${new Date().toLocaleDateString()}`, margin, yPos);
        yPos += 12;

        // Divider line
        doc.setDrawColor(200);
        doc.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 10;

        // Content
        doc.setFontSize(10);
        doc.setTextColor(60);

        currentSubtitles.forEach(sub => {
            checkNewPage(lineHeight + 3);

            const textContent = showTimestamps.checked
                ? `[${formatTime(sub.start)}] ${sub.text}`
                : sub.text;

            const lines = doc.splitTextToSize(textContent, pageWidth - (margin * 2));

            lines.forEach(line => {
                checkNewPage();
                doc.text(line, margin, yPos);
                yPos += lineHeight;
            });

            yPos += 2;
        });

        // Final page footer
        doc.setFontSize(9);
        doc.setTextColor(150);
        doc.text(`Page ${pageNum} - ytscript.com`, pageWidth / 2, pageHeight - 10, { align: 'center' });

        // Save
        doc.save(`${currentVideoId}_transcript.pdf`);
        showToast(`Downloaded ${currentVideoId}_transcript.pdf`, 'success');

    } catch (error) {
        console.error('PDF generation error:', error);
        showToast('Failed to generate PDF', 'error');
    }
}

// ==================== 
// Format Generators
// ====================
function getPlainText() {
    return currentSubtitles.map(sub => sub.text).join('\n');
}

function getTimestampedText() {
    return currentSubtitles.map(sub =>
        `[${formatTime(sub.start)}] ${sub.text}`
    ).join('\n');
}

function getSrtContent() {
    return currentSubtitles.map((sub, i) => {
        const start = formatSrtTime(sub.start);
        const end = formatSrtTime(sub.start + (sub.dur || 2));
        return `${i + 1}\n${start} --> ${end}\n${sub.text}\n`;
    }).join('\n');
}

function getVttContent() {
    let vtt = 'WEBVTT\n\n';
    vtt += currentSubtitles.map((sub, i) => {
        const start = formatVttTime(sub.start);
        const end = formatVttTime(sub.start + (sub.dur || 2));
        return `${i + 1}\n${start} --> ${end}\n${sub.text}\n`;
    }).join('\n');
    return vtt;
}

function getJsonContent() {
    return JSON.stringify({
        videoId: currentVideoId,
        language: currentLanguage,
        extractedAt: new Date().toISOString(),
        subtitles: currentSubtitles
    }, null, 2);
}

// ==================== 
// History Management
// ====================
function saveToHistory(videoId, language) {
    const history = getHistory();
    const entry = {
        videoId,
        language,
        timestamp: Date.now()
    };

    // Remove duplicate if exists
    const filtered = history.filter(h => h.videoId !== videoId);
    filtered.unshift(entry);

    // Keep only last 10
    const trimmed = filtered.slice(0, 10);
    localStorage.setItem('ytscript_history', JSON.stringify(trimmed));

    loadHistory();
}

function getHistory() {
    try {
        return JSON.parse(localStorage.getItem('ytscript_history') || '[]');
    } catch {
        return [];
    }
}

function loadHistory() {
    const history = getHistory();

    if (history.length === 0) {
        historySection?.classList.add('hidden');
        return;
    }

    historySection?.classList.remove('hidden');

    if (historyList) {
        historyList.innerHTML = history.map(h => `
            <div class="history-item" data-video-id="${h.videoId}">
                <span class="history-item-id">${h.videoId}</span>
                <span class="history-item-time">${formatRelativeTime(h.timestamp)}</span>
            </div>
        `).join('');

        // Add click handlers
        historyList.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const videoId = item.dataset.videoId;
                urlInput.value = `https://youtube.com/watch?v=${videoId}`;
                handleExtract();
            });
        });
    }
}

function clearAllHistory() {
    localStorage.removeItem('ytscript_history');
    loadHistory();
    showToast('History cleared', 'success');
}

// ==================== 
// Rate Limiting
// ====================
function getUsageData() {
    try {
        const data = JSON.parse(localStorage.getItem('ytscript_usage') || '{}');
        const now = Date.now();

        // Reset if window expired
        if (!data.windowStart || now - data.windowStart > RATE_WINDOW) {
            return { windowStart: now, count: 0 };
        }
        return data;
    } catch {
        return { windowStart: Date.now(), count: 0 };
    }
}

function getRemainingExtractions() {
    const data = getUsageData();
    return Math.max(0, RATE_LIMIT - data.count);
}

function incrementExtractionCount() {
    const data = getUsageData();
    data.count = (data.count || 0) + 1;
    if (!data.windowStart) data.windowStart = Date.now();
    localStorage.setItem('ytscript_usage', JSON.stringify(data));

    // Show remaining count
    const remaining = RATE_LIMIT - data.count;
    if (remaining <= 2 && remaining > 0) {
        showToast(`${remaining} extraction${remaining > 1 ? 's' : ''} remaining this hour`, 'warning');
    }
}

function getResetTimeString() {
    const data = getUsageData();
    const elapsed = Date.now() - data.windowStart;
    const remaining = RATE_WINDOW - elapsed;
    const minutes = Math.ceil(remaining / 60000);
    return minutes > 1 ? `${minutes} minutes` : '1 minute';
}

// ==================== 
// Utility Functions
// ====================
function isValidYouTubeUrl(url) {
    return /youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\//.test(url);
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatSrtTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)},${ms.toString().padStart(3, '0')}`;
}

function formatVttTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)}.${ms.toString().padStart(3, '0')}`;
}

function pad(n) {
    return n.toString().padStart(2, '0');
}

function formatRelativeTime(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== 
// Loading State
// ====================
const loadingState = document.getElementById('loadingState');
const loadingMessage = document.getElementById('loadingMessage');

const loadingMessages = [
    "Fetching subtitles...",
    "Connecting to YouTube...",
    "Processing transcript...",
    "Almost there...",
    "Extracting captions...",
    "Analyzing video data..."
];
let loadingMessageInterval = null;

function setLoading(loading) {
    extractBtn.classList.toggle('loading', loading);
    extractBtn.disabled = loading;
    urlInput.disabled = loading;

    if (loading) {
        emptyState?.classList.add('hidden');
        resultsSection?.classList.add('hidden');
        loadingState?.classList.remove('hidden');
        startLoadingMessages();
    } else {
        loadingState?.classList.add('hidden');
        stopLoadingMessages();
    }
}

function startLoadingMessages() {
    let index = 0;
    if (loadingMessage) {
        loadingMessage.textContent = loadingMessages[0];
        loadingMessageInterval = setInterval(() => {
            index = (index + 1) % loadingMessages.length;
            loadingMessage.textContent = loadingMessages[index];
        }, 2000);
    }
}

function stopLoadingMessages() {
    if (loadingMessageInterval) {
        clearInterval(loadingMessageInterval);
        loadingMessageInterval = null;
    }
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.add('visible');
}

function hideError() {
    errorMessage.classList.remove('visible');
}

function showToast(message, type = '') {
    toast.textContent = message;
    toast.className = 'toast visible';
    if (type) toast.classList.add(type);

    setTimeout(() => {
        toast.classList.remove('visible');
    }, 3000);
}

// ==================== 
// Keyboard Shortcuts
// ====================
document.addEventListener('keydown', (e) => {
    const isTyping = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    const hasResults = currentSubtitles.length > 0;

    // Ctrl/Cmd + K: Focus input
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        urlInput?.focus();
    }

    // Ctrl/Cmd + Enter: Extract
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleExtract();
    }

    // Escape: Clear input or blur
    if (e.key === 'Escape') {
        if (urlInput === document.activeElement) {
            urlInput.blur();
        }
    }

    // Shortcuts only when not typing
    if (!isTyping) {
        // ?: Show shortcuts (TODO: modal)
        if (e.key === '?' && !e.shiftKey) {
            e.preventDefault();
            showToast('⌨️ Ctrl+K: Focus | Ctrl+Enter: Extract | T: Timestamps');
        }

        // When results are visible
        if (hasResults) {
            // T: Toggle timestamps
            if (e.key === 't' || e.key === 'T') {
                e.preventDefault();
                showTimestamps.checked = !showTimestamps.checked;
                toggleTimestamps();
                showToast(showTimestamps.checked ? 'Timestamps ON' : 'Timestamps OFF');
            }

            // C: Copy
            if (e.key === 'c' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                handleCopy();
            }

            // 1: Download TXT
            if (e.key === '1') {
                e.preventDefault();
                handleDownload('txt');
            }

            // 2: Download SRT
            if (e.key === '2') {
                e.preventDefault();
                handleDownload('srt');
            }

            // 3: Download VTT
            if (e.key === '3') {
                e.preventDefault();
                handleDownload('vtt');
            }

            // 4: Download JSON
            if (e.key === '4') {
                e.preventDefault();
                handleDownload('json');
            }
        }
    }
});

// Ctrl/Cmd + \: Toggle theme
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        toggleTheme();
        const theme = document.documentElement.getAttribute('data-theme');
        showToast(`Theme: ${theme === 'dark' ? '🌙 Dark' : '☀️ Light'}`);
    }
});
