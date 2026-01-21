const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Twitch API Credentials - setz diese in Render als Environment Variables
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

// Token Cache
let accessToken = null;
let tokenExpiry = 0;

app.use(cors());
app.use(express.json());

// App Access Token holen (erneuert sich automatisch)
async function getAccessToken() {
    if (accessToken && Date.now() < tokenExpiry) {
        return accessToken;
    }

    console.log('Getting new Twitch access token...');
    
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: TWITCH_CLIENT_ID,
            client_secret: TWITCH_CLIENT_SECRET,
            grant_type: 'client_credentials'
        })
    });

    const data = await response.json();
    
    if (!data.access_token) {
        throw new Error('Failed to get access token');
    }

    accessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
    console.log('Got new access token');
    
    return accessToken;
}

// Twitch API Request
async function twitchAPI(endpoint) {
    const token = await getAccessToken();
    
    const response = await fetch(`https://api.twitch.tv/helix/${endpoint}`, {
        headers: {
            'Client-ID': TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${token}`
        }
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Twitch API Error');
    }

    return response.json();
}

// User ID von Username holen
async function getUserId(username) {
    const data = await twitchAPI(`users?login=${encodeURIComponent(username)}`);
    if (!data.data || data.data.length === 0) {
        throw new Error('User nicht gefunden');
    }
    return data.data[0];
}

// User Details zu einer Liste von IDs holen
async function getUserDetails(userIds) {
    if (userIds.length === 0) return [];
    
    // Max 100 pro Request
    const chunks = [];
    for (let i = 0; i < userIds.length; i += 100) {
        chunks.push(userIds.slice(i, i + 100));
    }

    let allUsers = [];
    for (const chunk of chunks) {
        const params = chunk.map(id => `id=${id}`).join('&');
        const data = await twitchAPI(`users?${params}`);
        allUsers = allUsers.concat(data.data || []);
    }

    return allUsers;
}

// ============ ENDPOINTS ============

// Health Check
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'TwitchTools API',
        endpoints: ['/api/mods', '/api/vips', '/api/founders', '/api/user'],
        usage: '/api/mods?channel=CHANNELNAME'
    });
});

// User Info
app.get('/api/user', async (req, res) => {
    try {
        const { channel } = req.query;
        if (!channel) {
            return res.status(400).json({ error: 'channel parameter required' });
        }

        const user = await getUserId(channel);
        res.json({
            id: user.id,
            login: user.login,
            display_name: user.display_name,
            profile_image_url: user.profile_image_url,
            created_at: user.created_at
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Moderatoren
app.get('/api/mods', async (req, res) => {
    try {
        const { channel } = req.query;
        if (!channel) {
            return res.status(400).json({ error: 'channel parameter required' });
        }

        // Über TMI (Chatters API) - funktioniert ohne spezielle Auth
        const tmiResponse = await fetch(`https://tmi.twitch.tv/group/user/${channel.toLowerCase()}/chatters`);
        
        if (!tmiResponse.ok) {
            throw new Error('Channel nicht gefunden oder offline');
        }

        const tmiData = await tmiResponse.json();
        const modNames = tmiData.chatters?.moderators || [];

        if (modNames.length === 0) {
            return res.json([]);
        }

        // User Details holen
        const params = modNames.slice(0, 100).map(name => `login=${name}`).join('&');
        const userData = await twitchAPI(`users?${params}`);

        const result = (userData.data || []).map(u => ({
            id: u.id,
            login: u.login,
            display_name: u.display_name,
            profile_image_url: u.profile_image_url
        }));

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// VIPs
app.get('/api/vips', async (req, res) => {
    try {
        const { channel } = req.query;
        if (!channel) {
            return res.status(400).json({ error: 'channel parameter required' });
        }

        // Über TMI
        const tmiResponse = await fetch(`https://tmi.twitch.tv/group/user/${channel.toLowerCase()}/chatters`);
        
        if (!tmiResponse.ok) {
            throw new Error('Channel nicht gefunden oder offline');
        }

        const tmiData = await tmiResponse.json();
        const vipNames = tmiData.chatters?.vips || [];

        if (vipNames.length === 0) {
            return res.json([]);
        }

        // User Details holen
        const params = vipNames.slice(0, 100).map(name => `login=${name}`).join('&');
        const userData = await twitchAPI(`users?${params}`);

        const result = (userData.data || []).map(u => ({
            id: u.id,
            login: u.login,
            display_name: u.display_name,
            profile_image_url: u.profile_image_url
        }));

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Founders (eingeschränkt - braucht eigentlich Broadcaster Auth)
app.get('/api/founders', async (req, res) => {
    try {
        const { channel } = req.query;
        if (!channel) {
            return res.status(400).json({ error: 'channel parameter required' });
        }

        // Founders sind leider nicht öffentlich abrufbar ohne Broadcaster-Auth
        // Wir geben eine Info zurück
        res.json({
            message: 'Founder-Daten benötigen Broadcaster-Authentifizierung und sind daher nicht öffentlich verfügbar.',
            data: []
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Server starten
app.listen(PORT, () => {
    console.log(`TwitchTools API läuft auf Port ${PORT}`);
    
    if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
        console.warn('⚠️  WARNUNG: TWITCH_CLIENT_ID oder TWITCH_CLIENT_SECRET nicht gesetzt!');
        console.warn('   Setze diese als Environment Variables in Render.');
    }
});
