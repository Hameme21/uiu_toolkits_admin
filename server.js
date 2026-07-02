const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = __dirname;
const port = Number(process.env.PORT || 4175);

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function sendFile(response, filePath) {
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
        'Content-Type': mimeTypes[extension] || 'application/octet-stream',
        'Cache-Control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://localhost:${port}`);
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
