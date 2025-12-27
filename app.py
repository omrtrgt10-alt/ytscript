from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import WebshareProxyConfig
import re
import os

app = Flask(__name__, static_folder='public', static_url_path='')
CORS(app)

# Proxy configuration - uses Webshare free proxies if available
# Set WEBSHARE_TOKEN environment variable in Render dashboard
WEBSHARE_TOKEN = os.environ.get('WEBSHARE_TOKEN', '')

def get_api():
    """Get YouTubeTranscriptApi instance, with proxy if available"""
    if WEBSHARE_TOKEN:
        proxy_config = WebshareProxyConfig(WEBSHARE_TOKEN)
        return YouTubeTranscriptApi(proxy_config=proxy_config)
    return YouTubeTranscriptApi()

def extract_video_id(url):
    """
    Extract video ID from various YouTube URL formats.
    """
    if not url:
        return None
    
    # Try youtu.be format
    match = re.search(r'youtu\.be/([a-zA-Z0-9_-]{11})', url)
    if match:
        return match.group(1)
    
    # Try youtube.com/watch?v= format
    match = re.search(r'[?&]v=([a-zA-Z0-9_-]{11})', url)
    if match:
        return match.group(1)
    
    # Try youtube.com/embed/ format
    match = re.search(r'youtube\.com/embed/([a-zA-Z0-9_-]{11})', url)
    if match:
        return match.group(1)
    
    # Try youtube.com/v/ format
    match = re.search(r'youtube\.com/v/([a-zA-Z0-9_-]{11})', url)
    if match:
        return match.group(1)
    
    # Check if it's just a video ID
    if re.match(r'^[a-zA-Z0-9_-]{11}$', url):
        return url
    
    return None

@app.route('/')
def index():
    return send_from_directory('public', 'index.html')

@app.route('/api/extract', methods=['POST'])
def extract_subtitles():
    try:
        data = request.get_json()
        url = data.get('url', '')
        
        if not url:
            return jsonify({'error': 'YouTube URL is required'}), 400
        
        video_id = extract_video_id(url)
        
        if not video_id:
            return jsonify({'error': 'Invalid YouTube URL. Please provide a valid YouTube video URL.'}), 400
        
        try:
            # Get API instance (with proxy if configured)
            api = get_api()
            
            # Auto-detect: fetch first available transcript in any language
            transcript = None
            used_lang = None
            
            try:
                # List all available transcripts and get the first one
                transcript_list = api.list(video_id)
                
                for t in transcript_list:
                    try:
                        transcript = t.fetch()
                        used_lang = f"{t.language} ({t.language_code})"
                        break
                    except:
                        continue
                        
            except Exception as e:
                error_str = str(e)
                # More user-friendly error messages
                if 'IP' in error_str or 'block' in error_str.lower():
                    return jsonify({'error': 'Service temporarily unavailable. Please try again in a few minutes.'}), 503
                return jsonify({'error': f'Could not fetch subtitles: {error_str}'}), 404
            
            if transcript is None:
                return jsonify({'error': 'No captions found for this video.'}), 404
            
            # Format the transcript snippets
            subtitles = []
            for snippet in transcript.snippets:
                subtitles.append({
                    'start': snippet.start,
                    'dur': snippet.duration,
                    'text': snippet.text
                })
            
            if len(subtitles) == 0:
                return jsonify({'error': 'No captions found for this video.'}), 404
            
            return jsonify({
                'success': True,
                'videoId': video_id,
                'language': used_lang,
                'subtitles': subtitles
            })
            
        except Exception as e:
            error_msg = str(e)
            print(f'Transcript fetch error: {error_msg}')
            if 'disabled' in error_msg.lower():
                return jsonify({'error': 'Subtitles are disabled for this video.'}), 404
            elif 'unavailable' in error_msg.lower():
                return jsonify({'error': 'Video is unavailable.'}), 404
            else:
                return jsonify({'error': f'Could not fetch subtitles: {error_msg}'}), 404
            
    except Exception as e:
        print(f'Error extracting subtitles: {e}')
        return jsonify({'error': f'Failed to extract subtitles: {str(e)}'}), 500

if __name__ == '__main__':
    print('🎬 YouTube Subtitle Extractor running at http://localhost:3000')
    if WEBSHARE_TOKEN:
        print('✅ Proxy enabled')
    else:
        print('⚠️  No proxy configured - set WEBSHARE_TOKEN for better reliability')
    app.run(host='0.0.0.0', port=3000, debug=True)
