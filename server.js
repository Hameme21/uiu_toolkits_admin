const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const rootDir = __dirname;
const port = Number(process.env.PORT || 4175);
const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME || 'drdfnqwgp';
const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY || '';
const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET || '';
const firebaseWebApiKey = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyA028mrZX2RcDewoBTy0vLHOXWAGR61mOk';
const adminEmails = (process.env.ADMIN_EMAILS || 'ahamim2510370@bscse.uiu.ac.bd')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf'
};

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    response.end(JSON.stringify(payload));
}

function sendFile(response, filePath) {
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
        'Content-Type': mimeTypes[extension] || 'application/octet-stream',
        'Cache-Control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(response);
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        let body = '';

        request.on('data', chunk => {
            body += chunk;
            if (body.length > 1024 * 1024) {
                request.destroy();
                reject(new Error('Request body is too large.'));
            }
        });

        request.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                reject(new Error('Invalid JSON request body.'));
            }
        });

        request.on('error', reject);
    });
}

function getBearerToken(request) {
    const header = request.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : '';
}

async function verifyAdminToken(idToken) {
    if (!idToken) {
        const error = new Error('Missing Firebase ID token.');
        error.statusCode = 401;
        throw error;
    }

    const lookupResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseWebApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
    });
    const lookupData = await lookupResponse.json();
    const firebaseUser = lookupData.users?.[0];
    const email = String(firebaseUser?.email || '').toLowerCase();

    if (!lookupResponse.ok || !firebaseUser) {
        const error = new Error(lookupData.error?.message || 'Could not verify Firebase user.');
        error.statusCode = 401;
        throw error;
    }

    if (!adminEmails.includes(email)) {
        const error = new Error('This Firebase user is not allowed to delete Cloudinary assets.');
        error.statusCode = 403;
        throw error;
    }

    return firebaseUser;
}

function signCloudinaryParams(params) {
    const payload = Object.keys(params)
        .filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '')
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join('&');

    return crypto
        .createHash('sha1')
        .update(`${payload}${cloudinaryApiSecret}`)
        .digest('hex');
}

function normalizeCloudinaryAssets(assets) {
    if (!Array.isArray(assets)) return [];

    return assets
        .map(asset => ({
            publicId: String(asset.publicId || '').trim(),
            resourceType: ['image', 'video', 'raw'].includes(asset.resourceType) ? asset.resourceType : 'raw'
        }))
        .filter(asset => asset.publicId);
}

async function destroyCloudinaryAsset(asset) {
    const timestamp = Math.floor(Date.now() / 1000);
    const params = {
        public_id: asset.publicId,
        invalidate: 'true',
        timestamp
    };
    const signature = signCloudinaryParams(params);
    const formData = new URLSearchParams({
        ...params,
        api_key: cloudinaryApiKey,
        signature
    });
    const destroyResponse = await fetch(`https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/${asset.resourceType}/destroy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
    });
    const data = await destroyResponse.json();

    if (!destroyResponse.ok) {
        throw new Error(data.error?.message || `Cloudinary could not delete ${asset.publicId}.`);
    }

    return {
        publicId: asset.publicId,
        resourceType: asset.resourceType,
        result: data.result || 'unknown'
    };
}

async function handleCloudinaryDelete(request, response) {
    if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
    }

    if (!cloudinaryApiKey || !cloudinaryApiSecret) {
        sendJson(response, 500, {
            error: 'Cloudinary delete is not configured. Set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET on the admin server.'
        });
        return;
    }

    try {
        await verifyAdminToken(getBearerToken(request));
        const body = await readJsonBody(request);
        const assets = normalizeCloudinaryAssets(body.assets);

        if (assets.length === 0) {
            sendJson(response, 400, { error: 'No Cloudinary public IDs were provided.' });
            return;
        }

        const deleted = [];
        for (const asset of assets) {
            deleted.push(await destroyCloudinaryAsset(asset));
        }

        sendJson(response, 200, { deleted });
    } catch (error) {
        console.error('Cloudinary delete failed:', error);
        sendJson(response, error.statusCode || 500, {
            error: error.message || 'Cloudinary delete failed.'
        });
    }
}

const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://localhost:${port}`);
    if (url.pathname === '/api/cloudinary/delete') {
        handleCloudinaryDelete(request, response);
        return;
    }

    if (url.pathname.startsWith('/api/')) {
        sendJson(response, 404, { error: 'API route not found.' });
        return;
    }

    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const requestedPath = path.normalize(path.join(rootDir, decodeURIComponent(pathname)));
    const relativePath = path.relative(rootDir, requestedPath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Forbidden');
        return;
    }

    fs.stat(requestedPath, (error, stats) => {
        if (error || !stats.isFile()) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Not found');
            return;
        }

        sendFile(response, requestedPath);
    });
});

server.listen(port, () => {
    console.log(`UIU Toolkits Admin running at http://localhost:${port}`);
});
