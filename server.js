const express = require('express');
const cors = require('cors');
const { getSubtitles } = require('youtube-captions-scraper');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Extract video ID from various YouTube URL formats
 * Supports:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - https://www.youtube.com/v/VIDEO_ID
 */
function extractVideoId(url) {
    if (!url) return null;
    
    // Try youtu.be format
    const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (shortMatch) return shortMatch[1];
    
    // Try youtube.com/watch?v= format
    const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (watchMatch) return watchMatch[1];
    
    // Try youtube.com/embed/ format
    const embedMatch = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) return embedMatch[1];
    
    // Try youtube.com/v/ format
    const vMatch = url.match(/youtube\.com\/v\/([a-zA-Z0-9_-]{11})/);
    if (vMatch) return vMatch[1];
    
    // Check if it's just a video ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
    
    return null;
}

/**
 * API endpoint to extract subtitles from a YouTube video
 */
app.post('/api/extract', async (req, res) => {
    try {
        const { url, lang } = req.body;
        
        if (!url) {
            return res.status(400).json({ 
                error: 'YouTube URL is required' 
            });
        }
        
        const videoId = extractVideoId(url);
        
        if (!videoId) {
            return res.status(400).json({ 
                error: 'Invalid YouTube URL. Please provide a valid YouTube video URL.' 
            });
        }
        
        // Try to get subtitles, prefer manual captions
        const languages = lang ? [lang] : ['en', 'en-US', 'en-GB'];
        let subtitles = null;
        let usedLang = null;
        
        for (const language of languages) {
            try {
                subtitles = await getSubtitles({
                    videoID: videoId,
                    lang: language
                });
                usedLang = language;
                break;
            } catch (e) {
                continue;
            }
        }
        
        // If no subtitles found in preferred languages, try auto-generated
        if (!subtitles) {
            try {
                subtitles = await getSubtitles({
                    videoID: videoId,
                    lang: 'en'
                });
                usedLang = 'en (auto)';
            } catch (e) {
                return res.status(404).json({ 
                    error: 'No captions found for this video. The video may not have subtitles available.' 
                });
            }
        }
        
        res.json({
            success: true,
            videoId,
            language: usedLang,
            subtitles
        });
        
    } catch (error) {
        console.error('Error extracting subtitles:', error);
        res.status(500).json({ 
            error: 'Failed to extract subtitles. Please check the URL and try again.' 
        });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🎬 YouTube Subtitle Extractor running at http://localhost:${PORT}`);
});
