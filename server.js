const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const nodemailer = require('nodemailer');

const rootDir = __dirname;
const port = Number(process.env.PORT || 4175);
const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME || '';
const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY || '';
const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET || '';
const cloudinaryUploadFolder = process.env.CLOUDINARY_UPLOAD_FOLDER || 'uiu-toolkits/question-bank';
const firebaseWebApiKey = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyA028mrZX2RcDewoBTy0vLHOXWAGR61mOk';

// SMTP Configuration for Email Notifications
const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER || ''; 
const smtpPass = process.env.SMTP_PASS || ''; 
const emailFrom = process.env.EMAIL_FROM || 'UIU Toolkits <noreply@uiu-toolkits.com>';

const adminEmails = (process.env.ADMIN_EMAILS || 'ahamim2510370@bscse.uiu.ac.bd')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map(origin => origin.trim())
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
    '.pdf': 'application/pdf',
    '.json': 'application/json; charset=utf-8'
};

function sendJson(response, statusCode, payload, requestOrigin = '') {
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...getCorsHeaders(requestOrigin)
    };
    response.writeHead(statusCode, headers);
    response.end(JSON.stringify(payload));
}

function getCorsHeaders(requestOrigin = '') {
    const allowAll = allowedOrigins.includes('*');
    const originAllowed = allowAll || allowedOrigins.includes(requestOrigin);

    if (!originAllowed && requestOrigin) {
        return {};
    }

    return {
        'Access-Control-Allow-Origin': allowAll ? '*' : requestOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type'
    };
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

function getRequestOrigin(request) {
    return String(request.headers.origin || '');
}

function normalizeText(value) {
    return String(value || '').trim();
}

function isValidContactEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(normalizeText(value));
}

function isValidAssetType(value) {
    return value === 'question' || value === 'solution';
}

function sanitizeContextValue(value) {
    return normalizeText(value)
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|')
        .replace(/=/g, '\\=');
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
        const error = new Error('This Firebase user is not allowed to perform admin actions.');
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
            publicId: String(asset.publicId || asset.public_id || '').trim(),
            resourceType: ['image', 'video', 'raw'].includes(asset.resourceType || asset.resource_type)
                ? (asset.resourceType || asset.resource_type)
                : 'raw'
        }))
        .filter(asset => asset.publicId);
}

function ensureCloudinaryConfigured(response, requestOrigin) {
    if (!cloudinaryApiKey || !cloudinaryApiSecret) {
        sendJson(response, 500, {
            error: 'Cloudinary is not configured. Set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET on the server.'
        }, requestOrigin);
        return false;
    }
    return true;
}

async function handleHealth(request, response) {
    sendJson(response, 200, {
        ok: true,
        service: 'uiu-toolkits-admin',
        cloudinaryConfigured: Boolean(cloudinaryApiKey && cloudinaryApiSecret),
        cloudName: cloudinaryCloudName,
        uploadFolder: cloudinaryUploadFolder
    }, getRequestOrigin(request));
}

async function handleCloudinaryConfig(request, response) {
    sendJson(response, 200, {
        cloudName: cloudinaryCloudName,
        uploadFolder: cloudinaryUploadFolder,
        signedUploads: Boolean(cloudinaryApiKey && cloudinaryApiSecret)
    }, getRequestOrigin(request));
}

async function handleCloudinarySignUpload(request, response) {
    if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed.' }, getRequestOrigin(request));
        return;
    }

    const requestOrigin = getRequestOrigin(request);
    if (!ensureCloudinaryConfigured(response, requestOrigin)) return;

    try {
        const body = await readJsonBody(request);
        const assetType = normalizeText(body.assetType).toLowerCase();
        const courseCode = normalizeText(body.courseCode).replace(/\s+/g, ' ').toUpperCase();
        const assetLabel = normalizeText(body.assetLabel);
        
        const resourceType = 'image';

        if (!isValidAssetType(assetType)) {
            sendJson(response, 400, { error: 'assetType must be "question" or "solution".' }, requestOrigin);
            return;
        }

        if (!courseCode) {
            sendJson(response, 400, { error: 'courseCode is required.' }, requestOrigin);
            return;
        }

        if (!assetLabel) {
            sendJson(response, 400, { error: 'assetLabel is required.' }, requestOrigin);
            return;
        }

        const timestamp = Math.floor(Date.now() / 1000);
        const uploadParams = {
            folder: cloudinaryUploadFolder,
            tags: `uiu-toolkits,question-bank,pending-review,${assetType}`,
            context: `caption=${sanitizeContextValue(assetLabel)}|course=${sanitizeContextValue(courseCode)}|asset=${assetType}`,
            timestamp
        };
        const signature = signCloudinaryParams(uploadParams);

        sendJson(response, 200, {
            cloudName: cloudinaryCloudName,
            apiKey: cloudinaryApiKey,
            signature,
            resourceType,
            uploadUrl: `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/${resourceType}/upload`,
            uploadParams
        }, requestOrigin);
    } catch (error) {
        console.error('Cloudinary sign upload failed:', error);
        sendJson(response, error.statusCode || 500, {
            error: error.message || 'Could not sign Cloudinary upload.'
        }, requestOrigin);
    }
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

async function mutateCloudinaryTag(asset, tag, action) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signParams = {
        public_ids: asset.publicId,
        timestamp
    };
    const tagForm = new URLSearchParams({
        public_ids: asset.publicId,
        timestamp: String(timestamp),
        api_key: cloudinaryApiKey,
        signature: signCloudinaryParams(signParams)
    });
    const tagResponse = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/${asset.resourceType}/tags/${encodeURIComponent(tag)}/${action}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tagForm
        }
    );
    const tagData = await tagResponse.json();

    if (!tagResponse.ok) {
        throw new Error(tagData.error?.message || `Could not ${action} tag "${tag}" on ${asset.publicId}.`);
    }

    return { action, tag, publicId: asset.publicId, result: tagData };
}

async function updateCloudinaryAssetTags(asset, addTags, removeTags) {
    const results = [];

    for (const tag of removeTags) {
        results.push(await mutateCloudinaryTag(asset, tag, 'remove'));
    }

    for (const tag of addTags) {
        results.push(await mutateCloudinaryTag(asset, tag, 'add'));
    }

    return {
        publicId: asset.publicId,
        resourceType: asset.resourceType,
        tagUpdates: results
    };
}

async function handleCloudinaryDelete(request, response) {
    if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed.' }, getRequestOrigin(request));
        return;
    }

    const requestOrigin = getRequestOrigin(request);
    if (!ensureCloudinaryConfigured(response, requestOrigin)) return;

    try {
        await verifyAdminToken(getBearerToken(request));
        const body = await readJsonBody(request);
        const assets = normalizeCloudinaryAssets(body.assets);

        if (assets.length === 0) {
            sendJson(response, 400, { error: 'No Cloudinary public IDs were provided.' }, requestOrigin);
            return;
        }

        const deleted = [];
        for (const asset of assets) {
            deleted.push(await destroyCloudinaryAsset(asset));
        }

        sendJson(response, 200, { deleted }, requestOrigin);
    } catch (error) {
        console.error('Cloudinary delete failed:', error);
        sendJson(response, error.statusCode || 500, {
            error: error.message || 'Cloudinary delete failed.'
        }, requestOrigin);
    }
}

async function handleCloudinaryApproveAssets(request, response) {
    if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed.' }, getRequestOrigin(request));
        return;
    }

    const requestOrigin = getRequestOrigin(request);
    if (!ensureCloudinaryConfigured(response, requestOrigin)) return;

    try {
        await verifyAdminToken(getBearerToken(request));
        const body = await readJsonBody(request);
        const assets = normalizeCloudinaryAssets(body.assets);

        if (assets.length === 0) {
            sendJson(response, 400, { error: 'No Cloudinary public IDs were provided.' }, requestOrigin);
            return;
        }

        const updated = [];
        for (const asset of assets) {
            updated.push(await updateCloudinaryAssetTags(asset, ['approved'], ['pending-review']));
        }

        sendJson(response, 200, { updated }, requestOrigin);
    } catch (error) {
        console.error('Cloudinary approve assets failed:', error);
        sendJson(response, error.statusCode || 500, {
            error: error.message || 'Cloudinary approve failed.'
        }, requestOrigin);
    }
}

async function handleQuestionsSubmit(request, response) {
    if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed.' }, getRequestOrigin(request));
        return;
    }

    const requestOrigin = getRequestOrigin(request);
    try {
        const body = await readJsonBody(request);
        const submitterEmail = normalizeText(body.submitterEmail).toLowerCase();
        const courseCode = normalizeText(body.courseCode).replace(/\s+/g, ' ').toUpperCase();
        const courseName = normalizeText(body.courseName);
        const trimester = normalizeText(body.trimester);
        const examType = normalizeText(body.examType);
        const questionAsset = body.questionAsset || {};
        const solutionAsset = body.solutionAsset || null;

        if (!isValidContactEmail(submitterEmail)) {
            sendJson(response, 400, { error: 'A valid contact email is required.' }, requestOrigin);
            return;
        }

        if (!courseCode || !courseName || !trimester || !examType) {
            sendJson(response, 400, { error: 'courseCode, courseName, trimester, and examType are required.' }, requestOrigin);
            return;
        }

        if (!normalizeText(questionAsset.public_id || questionAsset.publicId)) {
            sendJson(response, 400, { error: 'questionAsset.public_id is required after Cloudinary upload.' }, requestOrigin);
            return;
        }

        sendJson(response, 200, {
            success: true,
            message: 'Question metadata validated. Save this submission to Firestore from the client.',
            submission: {
                title: `${courseCode} - ${courseName} ${examType} ${trimester}`,
                courseCode,
                courseName,
                trimester,
                examType,
                submitterEmail,
                status: 'pending',
                pdfUrl: questionAsset.secure_url || questionAsset.secureUrl || '',
                cloudinaryPublicId: questionAsset.public_id || questionAsset.publicId || '',
                cloudinaryResourceType: 'image',
                cloudinaryAssetId: questionAsset.asset_id || questionAsset.assetId || '',
                bytes: questionAsset.bytes || 0,
                originalFilename: questionAsset.original_filename || questionAsset.originalFilename || '',
                solutionPdfUrl: solutionAsset?.secure_url || solutionAsset?.secureUrl || '',
                solutionCloudinaryPublicId: solutionAsset?.public_id || solutionAsset?.publicId || '',
                solutionCloudinaryResourceType: solutionAsset ? 'image' : '',
                solutionCloudinaryAssetId: solutionAsset?.asset_id || solutionAsset?.assetId || '',
                solutionBytes: solutionAsset?.bytes || 0,
                solutionOriginalFilename: solutionAsset?.original_filename || solutionAsset?.originalFilename || ''
            }
        }, requestOrigin);
    } catch (error) {
        console.error('Question submit validation failed:', error);
        sendJson(response, error.statusCode || 500, {
            error: error.message || 'Question submit failed.'
        }, requestOrigin);
    }
}

async function handleQuestionsNotify(request, response) {
    if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed.' }, getRequestOrigin(request));
        return;
    }

    const requestOrigin = getRequestOrigin(request);

    try {
        await verifyAdminToken(getBearerToken(request));
        const body = await readJsonBody(request);
        
        const recipientEmail = normalizeText(body.email).toLowerCase();
        const status = normalizeText(body.status).toLowerCase(); 
        const courseCode = normalizeText(body.courseCode);
        const courseName = normalizeText(body.courseName);
        const examType = normalizeText(body.examType);
        const trimester = normalizeText(body.trimester);

        if (!recipientEmail || !status || !courseCode) {
            sendJson(response, 400, { error: 'email, status, and courseCode are required.' }, requestOrigin);
            return;
        }

        if (!smtpUser || !smtpPass) {
            console.warn('SMTP configuration values are missing. Email notifications skipped.');
            sendJson(response, 200, { success: true, message: 'Notification skipped due to missing SMTP details.' }, requestOrigin);
            return;
        }

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: {
                user: smtpUser,
                pass: smtpPass
            }
        });

        const isApproved = status === 'approved';
        const subject = isApproved 
            ? `Approved: Your question paper submission for ${courseCode}`
            : `Rejected: Your question paper submission for ${courseCode}`;

        const textMessage = isApproved
            ? `Hello,\n\nYour question paper submission for ${courseCode} (${courseName}) : ${examType} (${trimester}) has been approved by the administrator. It is now visible in the public UIU Question Bank.\n\nThank you for your contribution.\n\nBest regards,\nUIU Toolkits Team`
            : `Hello,\n\nWe regret to inform you that your question paper submission for ${courseCode} (${courseName}) : ${examType} (${trimester}) has been rejected and deleted from our storage repository. This usually occurs if the file layout is unreadable or if duplicate content already exists.\n\nBest regards,\nUIU Toolkits Team`;

        await transporter.sendMail({
            from: emailFrom,
            to: recipientEmail,
            subject: subject,
            text: textMessage
        });

        sendJson(response, 200, { success: true, message: 'Notification email dispatched successfully.' }, requestOrigin);
    } catch (error) {
        console.error('Failed to dispatch notification email:', error);
        sendJson(response, error.statusCode || 500, {
            error: error.message || 'Could not send email notification.'
        }, requestOrigin);
    }
}

const apiRoutes = {
    '/api/health': handleHealth,
    '/api/cloudinary/config': handleCloudinaryConfig,
    '/api/cloudinary/sign-upload': handleCloudinarySignUpload,
    '/api/cloudinary/delete': handleCloudinaryDelete,
    '/api/cloudinary/approve-assets': handleCloudinaryApproveAssets,
    '/api/questions/submit': handleQuestionsSubmit,
    '/api/questions/upload': handleQuestionsSubmit,
    '/api/questions/notify': handleQuestionsNotify 
};

const server = http.createServer((request, response) => {
    const requestOrigin = getRequestOrigin(request);

    if (request.method === 'OPTIONS') {
        response.writeHead(204, getCorsHeaders(requestOrigin));
        response.end();
        return;
    }

    const url = new URL(request.url, `http://localhost:${port}`);
    const routeHandler = apiRoutes[url.pathname];

    if (routeHandler) {
        if (request.method === 'GET' && url.pathname !== '/api/health' && url.pathname !== '/api/cloudinary/config') {
            sendJson(response, 405, { error: 'Method not allowed.' }, requestOrigin);
            return;
        }
        routeHandler(request, response);
        return;
    }

    if (url.pathname.startsWith('/api/')) {
        sendJson(response, 404, { error: 'API route not found.' }, requestOrigin);
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
    console.log(`UIU Toolkits backend running at http://localhost:${port}`);
    console.log(`Admin panel: http://localhost:${port}/admin.html`);
    console.log(`Question bank: http://localhost:${port}/uiu_toolkits.html`);
});
