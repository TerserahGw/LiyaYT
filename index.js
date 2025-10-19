const express = require('express');
const yts = require('yt-search');

const app = express();
const port = process.env.PORT || 3000;

const yt = {
    get url() {
        return {
            origin: 'https://ytmp3.cx'
        }
    },

    get baseHeaders() {
        return {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'en-US,en;q=0.9',
            'cache-control': 'no-cache',
            'pragma': 'no-cache',
            'sec-ch-ua': '"Chromium";v="123", "Not:A-Brand";v="8"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'none',
            'upgrade-insecure-requests': '1',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
        }
    },

    extractVideoId: function (fV) {
        let v
        if (fV.indexOf('youtu.be') > -1) {
            v = /\/([a-zA-Z0-9\-\_]{11})/.exec(fV);
        } else if (fV.indexOf('youtube.com') > -1) {
            if (fV.indexOf('/shorts/') > -1) {
                v = /\/([a-zA-Z0-9\-\_]{11})/.exec(fV);
            } else {
                v = /v\=([a-zA-Z0-9\-\_]{11})/.exec(fV);
            }
        }
        const result = v?.[1]
        if (!result) throw Error(`gagal extract video id`)
        return result
    },

    getInitUrl: async function () {
        try {
            console.log('Mengambil homepage...');
            const r1 = await fetch(this.url.origin, { 
                headers: this.baseHeaders 
            });
            
            if (!r1.ok) {
                throw new Error(`HTTP error! status: ${r1.status}`);
            }

            const html = await r1.text();
            console.log('Homepage berhasil diambil');

            // Cari script utama
            const scriptMatch = html.match(/<script src="(\/js\/app\.[a-f0-9]+\.js)"/);
            if (!scriptMatch) {
                throw new Error('Tidak dapat menemukan script utama');
            }

            const jsPath = scriptMatch[1];
            const jsUrl = this.url.origin + jsPath;
            console.log('JS URL:', jsUrl);

            // Ambil script JS
            const r2 = await fetch(jsUrl, { 
                headers: this.baseHeaders 
            });
            
            if (!r2.ok) {
                throw new Error(`HTTP error! status: ${r2.status}`);
            }

            const js = await r2.text();
            console.log('JS berhasil diambil');

            // Cari baseURL dengan regex yang lebih robust
            const baseUrlMatch = js.match(/baseURL:\s*"([^"]+)"/);
            if (!baseUrlMatch) {
                // Coba pattern alternatif
                const altMatch = js.match(/baseURL\s*=\s*"([^"]+)"/);
                if (!altMatch) {
                    throw new Error('Tidak dapat menemukan baseURL');
                }
                return altMatch[1];
            }

            const baseURL = baseUrlMatch[1];
            console.log('Base URL ditemukan:', baseURL);
            
            return baseURL;

        } catch (error) {
            console.error('Error di getInitUrl:', error.message);
            throw new Error(`Gagal mendapatkan init URL: ${error.message}`);
        }
    },

    download: async function (url, f = 'mp3') {
        if (!/^mp3|mp4$/.test(f)) {
            throw Error(`Format harus mp3 atau mp4`);
        }

        const v = this.extractVideoId(url);
        console.log('Video ID:', v);

        const headers = {
            'referer': this.url.origin,
            ...this.baseHeaders,
            'content-type': 'application/json',
            'origin': this.url.origin
        };

        // Get init URL
        const baseURL = await this.getInitUrl();
        const initApi = `${baseURL}/api/init`;
        console.log('Init API:', initApi);

        // Hit init endpoint
        const r1 = await fetch(initApi, { 
            method: 'POST',
            headers: headers,
            body: JSON.stringify({})
        });

        if (!r1.ok) {
            throw new Error(`Init request failed: ${r1.status}`);
        }

        const j1 = await r1.json();
        console.log('Init response:', j1);

        if (!j1.convertURL) {
            throw new Error('Convert URL tidak ditemukan di response init');
        }

        // Hit convert endpoint
        const convertApi = j1.convertURL + '&v=' + v + '&f=' + f;
        console.log('Convert API:', convertApi);

        const r2 = await fetch(convertApi, { headers });
        const j2 = await r2.json();
        console.log('Convert response:', j2);

        if (j2.error) {
            throw Error(`Error di convert: ${j2.error}`);
        }

        if (j2.redirectURL) {
            // Jika ada redirect URL
            const r3 = await fetch(j2.redirectURL, { headers });
            const j3 = await r3.json();
            
            const result = {
                title: j3.title || 'Unknown Title',
                downloadURL: j3.downloadURL,
                format: f,
                duration: j3.duration || null,
                quality: j3.quality || null
            };
            return result;
        } else if (j2.progressURL) {
            // Jika perlu polling progress
            let progressData;
            let attempts = 0;
            const maxAttempts = 10;
            
            do {
                await new Promise(resolve => setTimeout(resolve, 2000));
                const r3 = await fetch(j2.progressURL, { headers });
                progressData = await r3.json();
                attempts++;
                
                console.log(`Progress check ${attempts}:`, progressData);
                
                if (progressData.error) {
                    throw Error(`Error progress: ${progressData.error}`);
                }
                
                if (progressData.progress === 3 || progressData.downloadURL) {
                    const result = {
                        title: progressData.title || j2.title || 'Unknown Title',
                        downloadURL: progressData.downloadURL || j2.downloadURL,
                        format: f,
                        duration: progressData.duration || null,
                        quality: progressData.quality || null
                    };
                    return result;
                }
                
            } while (attempts < maxAttempts);
            
            throw new Error('Timeout menunggu konversi selesai');
        } else if (j2.downloadURL) {
            // Jika langsung dapat download URL
            const result = {
                title: j2.title || 'Unknown Title',
                downloadURL: j2.downloadURL,
                format: f,
                duration: j2.duration || null,
                quality: j2.quality || null
            };
            return result;
        } else {
            throw new Error('Tidak dapat menemukan download URL');
        }
    }
}

// Routes
app.get('/yt', async (req, res) => {
    try {
        const { url, format = 'mp3' } = req.query;
        
        if (!url) {
            return res.status(400).json({ 
                status: 'error',
                message: 'Parameter url diperlukan' 
            });
        }

        console.log(`Request download: ${url}, format: ${format}`);
        const result = await yt.download(url, format);
        
        res.json({
            status: 'success',
            data: result
        });
        
    } catch (error) {
        console.error('Error di /yt endpoint:', error.message);
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

app.get('/yts', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ 
                status: 'error',
                message: 'Parameter query diperlukan' 
            });
        }

        console.log(`Search query: ${query}`);
        const searchResult = await yts(query);
        
        const videos = searchResult.videos.slice(0, 10).map(video => ({
            videoId: video.videoId,
            title: video.title,
            url: video.url,
            duration: video.duration.timestamp,
            timestamp: video.timestamp,
            views: video.views,
            author: {
                name: video.author.name,
                channelUrl: video.author.url
            },
            thumbnail: video.thumbnail,
            uploaded: video.ago,
            description: video.description
        }));

        res.json({
            status: 'success',
            data: {
                query: query,
                totalResults: searchResult.all.length,
                results: videos
            }
        });
        
    } catch (error) {
        console.error('Error di /yts endpoint:', error.message);
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

app.get('/', (req, res) => {
    res.json({
        status: 'success',
        message: 'YouTube Downloader API',
        endpoints: {
            '/yt': {
                method: 'GET',
                parameters: {
                    url: 'YouTube URL (required)',
                    format: 'mp3 atau mp4 (optional, default: mp3)'
                },
                example: '/yt?url=https://www.youtube.com/watch?v=VIDEO_ID&format=mp3'
            },
            '/yts': {
                method: 'GET',
                parameters: {
                    query: 'Search query (required)'
                },
                example: '/yts?query=superman+theme'
            }
        }
    });
});

app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
    console.log(`Coba akses: http://localhost:${port}/yt?url=https://www.youtube.com/watch?v=Fmf-G9fpwto&format=mp3`);
});        } else {
            let j3b
            do {
                const r3b = await fetch(j2.progressURL, { headers })
                j3b = await r3b.json()
                if (j3b.error) throw Error(`ada error pas cek progress`)
                if (j3b.progress == 3) {
                    const result = {
                        title: j3b.title,
                        downloadURL: j2.downloadURL,
                        format: f
                    }
                    return result
                }
                await new Promise(resolve => setTimeout(resolve, 3000))
            } while (j3b.error != 3)
        }
    }
}

app.get('/yt', async (req, res) => {
    try {
        const { url, format = 'mp3' } = req.query;
        if (!url) {
            return res.status(400).json({ error: 'Parameter url diperlukan' });
        }
        
        const result = await yt.download(url, format);
        res.json({
            status: 'success',
            data: result
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

app.get('/yts', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ error: 'Parameter query diperlukan' });
        }

        const searchResult = await yts(query);
        const videos = searchResult.videos.slice(0, 10).map(video => ({
            title: video.title,
            url: video.url,
            duration: video.duration.timestamp,
            views: video.views,
            author: video.author.name,
            thumbnail: video.thumbnail,
            uploaded: video.ago
        }));

        res.json({
            status: 'success',
            data: {
                query: query,
                results: videos
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});
