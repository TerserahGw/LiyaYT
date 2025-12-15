const express = require('express');
const yts = require('yt-search');
const app = express();
const port = process.env.PORT || 3000;

const yt = {
    url: Object.freeze({
        audio128: 'https://api.apiapi.lat',
        video: 'https://api5.apiapi.lat',
        else: 'https://api3.apiapi.lat',
        referrer: 'https://ogmp3.pro/'
    }),

    encUrl: (string) => string.split('').map(c => c.charCodeAt()).reverse().join(';'),
    xor: (string) => string.split('').map(s => String.fromCharCode(s.charCodeAt() ^ 1)).join(''),
    genRandomHex: () => {
        const hex = '0123456789abcdef'.split('')
        return Array.from({ length: 32 }, _ => hex[Math.floor(Math.random() * hex.length)]).join('')
    },

    extractVideoId: function (fV) {
        let v
        if (fV.indexOf('youtu.be') > -1) v = /\/([a-zA-Z0-9\-\_]{11})/.exec(fV);
        else if (fV.indexOf('youtube.com') > -1) {
            if (fV.indexOf('/shorts/') > -1) v = /\/([a-zA-Z0-9\-\_]{11})/.exec(fV);
            else v = /v\=([a-zA-Z0-9\-\_]{11})/.exec(fV);
        }
        const result = v?.[1]
        if (!result) throw Error(`gagal extract video id`)
        return result
    },

    init: async function (rpObj) {
        const { apiOrigin, payload } = rpObj
        const { data } = payload
        const api = apiOrigin + '/' + this.genRandomHex() + '/init/' + this.encUrl(this.xor(data)) + '/' + this.genRandomHex() + '/'
        let resp = await fetch(api, {
            method: 'post',
            body: JSON.stringify(payload)
        })
        if (!resp.ok) throw Error(`${resp.status} ${resp.statusText}\n${await resp.text()}`)
        const json = await resp.json()
        return json
    },

    genFileUrl: function (i, pk, rpObj) {
        const { apiOrigin } = rpObj
        const pk_value = pk ? pk + "/" : "";
        const downloadUrl = apiOrigin + "/" + this.genRandomHex() + "/download/" + i + "/" + this.genRandomHex() + "/" + pk_value;
        return { downloadUrl }
    },

    statusCheck: async function (i, pk, rpObj) {
        const { apiOrigin } = rpObj
        let json = {}
        let counter = 0
        do {
            await new Promise(resolve => setTimeout(resolve, 5000))
            counter++
            const pk_value = pk ? pk + '/' : ''
            let api = apiOrigin + '/' + this.genRandomHex() + '/status/' + i + '/' + this.genRandomHex() + '/' + pk_value
            const resp = await fetch(api, {
                method: 'post',
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ data: i })
            })
            if (!resp.ok) throw Error(`${resp.status} ${resp.statusText}\n${await resp.text()}`)
            json = await resp.json()
            if(counter >= 100) throw Error (`pooling mencapai 100 kali`)
        } while (json.s === "P")
        if (json.s === "E") throw Error('gagal\n' + JSON.stringify(json, null, 2))
        return this.genFileUrl(i, pk, rpObj)
    },

    downloadSingle: async function (ytUrl, userFormat) {
        const rpObj = this.resolvePayload(ytUrl, userFormat)
        const initObj = await this.init(rpObj)
        const { i, pk, s } = initObj
        let result = { userFormat }
        if (s === 'C') {
            const wolep = this.genFileUrl(i, pk, rpObj)
            Object.assign(result, wolep)
        } else {
            const wolep = await this.statusCheck(i, pk, rpObj)
            Object.assign(result, wolep)
        }
        return result
    },

    resolvePayload: function (ytUrl, userFormat) {
        const validFormat = ['64k', '96k', '128k', '192k', '256k', '320k', '240p', '360p', '480p', '720p', '1080p']
        if (!validFormat.includes(userFormat)) throw Error(`format salah: ${validFormat.join(', ')}`)
        if (typeof (ytUrl) !== "string" || !ytUrl.trim().length) throw Error('youtube url kosong')

        let apiOrigin = this.url.audio128
        let data = this.xor(ytUrl)
        let referer = this.url.referrer
        let format = '0'
        let mp3Quality = '128'
        let mp4Quality = '720'

        if (userFormat === '128k') {
            apiOrigin = this.url.audio128
        } else if (/^\d+p$/.test(userFormat)) {
            apiOrigin = this.url.video
            mp4Quality = userFormat.match(/\d+/g)[0]
            format = '1'
        } else {
            apiOrigin = this.url.else
            mp3Quality = userFormat.match(/\d+/g)[0]
        }
        const payload = {
            data,
            format,
            referer,
            mp3Quality,
            mp4Quality,
            "userTimeZone": "-480"
        }
        return { apiOrigin, payload }
    },

    download: async function (ytUrl, userFormat = 'mp3') {
        const videoId = this.extractVideoId(ytUrl);
        const searchResult = await yts({ videoId: videoId });
        const title = searchResult.title;

        if (userFormat === 'mp3') {
            const qualities = ['256k', '192k', '128k', '96k', '64k'];
            for (const quality of qualities) {
                try {
                    const result = await this.downloadSingle(ytUrl, quality);
                    if (result && result.downloadUrl) {
                        return {
                            title: title,
                            downloadURL: result.downloadUrl,
                            format: 'mp3',
                            quality: quality
                        };
                    }
                } catch (error) {
                    continue;
                }
            }
            throw new Error('Semua kualitas audio gagal');
        } 
        else if (userFormat === 'mp4') {
            const qualities = ['720p', '480p', '360p', '240p'];
            for (const quality of qualities) {
                try {
                    const result = await this.downloadSingle(ytUrl, quality);
                    if (result && result.downloadUrl) {
                        return {
                            title: title,
                            downloadURL: result.downloadUrl,
                            format: 'mp4',
                            quality: quality
                        };
                    }
                } catch (error) {
                    continue;
                }
            }
            throw new Error('Semua kualitas video gagal');
        } 
        else {
            const result = await this.downloadSingle(ytUrl, userFormat);
            let format = 'mp3';
            if (userFormat.includes('p')) format = 'mp4';
            return {
                title: title,
                downloadURL: result.downloadUrl,
                format: format,
                quality: userFormat
            };
        }
    }
}

app.get('/yt', async (req, res) => {
    try {
        const { url, format = 'mp3' } = req.query;
        if (!url) return res.status(400).json({ status: 'error', message: 'Parameter url diperlukan' });

        console.log(`Request: ${url}, format: ${format}`);
        const result = await yt.download(url, format);
        
        res.json({
            status: 'success',
            data: {
                title: result.title,
                downloadURL: result.downloadURL,
                format: format.toLowerCase().includes('mp') ? format : result.format
            }
        });
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/yts', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) return res.status(400).json({ status: 'error', message: 'Parameter query diperlukan' });

        console.log(`Search: ${query}`);
        const searchResult = await yts(query);
        const videos = searchResult.videos.slice(0, 10).map(video => ({
            videoId: video.videoId,
            title: video.title,
            url: video.url,
            duration: video.duration.timestamp,
            timestamp: video.timestamp,
            views: video.views,
            author: { name: video.author.name, channelUrl: video.author.url },
            thumbnail: video.thumbnail,
            uploaded: video.ago,
            description: video.description
        }));

        res.json({
            status: 'success',
            data: { query: query, totalResults: searchResult.all.length, results: videos }
        });
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/', (req, res) => {
    res.json({
        status: 'success',
        message: 'YouTube Downloader API',
        endpoints: {
            '/yt': {
                method: 'GET',
                parameters: { url: 'YouTube URL (required)', format: 'mp3, mp4, 64k, 96k, 128k, 192k, 256k, 320k, 240p, 360p, 480p, 720p, 1080p (default: mp3)' },
                examples: {
                    mp3_default: '/yt?url=URL&format=mp3',
                    mp4_default: '/yt?url=URL&format=mp4',
                    high_quality: '/yt?url=URL&format=320k',
                    hd_video: '/yt?url=URL&format=1080p'
                }
            },
            '/yts': { method: 'GET', parameters: { query: 'Search query (required)' } }
        }
    });
});

app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});
