const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { startCleanupCron } = require('./utils/cleanup');
const { uploadToSupabase } = require('./utils/supabaseUpload');
const { 
    createTransaction, getTransaction, getTransactionStatus,
    setTransactionStatus, expireTransaction,
    getFrames, getFrame, addFrame, updateFrame, deleteFrame,
    getStats 
} = require('./utils/state');

const app = express();
const PORT = 3000;
const PAYMENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ─── Gallery Storage Setup ───────────────────────────────────
const GALLERIES_DIR = path.join(__dirname, 'galleries');
if (!fs.existsSync(GALLERIES_DIR)) fs.mkdirSync(GALLERIES_DIR);
app.use('/galleries', express.static(GALLERIES_DIR));

// Start background cleanup cron job
startCleanupCron(GALLERIES_DIR);

// ─── HTTP Server + WebSocket ─────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Track connected WebSocket clients by transactionId
const wsClients = new Map(); // txId -> Set<ws>

wss.on('connection', (ws, req) => {
    // Client connects with ?txId=TX-xxxx
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const txId = url.searchParams.get('txId');
    
    if (txId) {
        if (!wsClients.has(txId)) {
            wsClients.set(txId, new Set());
        }
        wsClients.get(txId).add(ws);
        console.log(`[WS] Client subscribed to transaction: ${txId}`);
        
        // If already paid, notify immediately
        const status = getTransactionStatus(txId);
        if (status === 'PAID') {
            ws.send(JSON.stringify({ type: 'PAYMENT_SUCCESS', transactionId: txId }));
        }
    }

    ws.on('close', () => {
        if (txId && wsClients.has(txId)) {
            wsClients.get(txId).delete(ws);
            if (wsClients.get(txId).size === 0) {
                wsClients.delete(txId);
            }
        }
    });
});

function notifyPaymentSuccess(transactionId) {
    if (wsClients.has(transactionId)) {
        const message = JSON.stringify({ type: 'PAYMENT_SUCCESS', transactionId });
        for (const client of wsClients.get(transactionId)) {
            if (client.readyState === 1) { // OPEN
                client.send(message);
            }
        }
    }
}

function notifyPaymentExpired(transactionId) {
    if (wsClients.has(transactionId)) {
        const message = JSON.stringify({ type: 'PAYMENT_EXPIRED', transactionId });
        for (const client of wsClients.get(transactionId)) {
            if (client.readyState === 1) {
                client.send(message);
            }
        }
    }
}

// ─── Payment Endpoints ───────────────────────────────────────

/**
 * Generate QRIS — Now produces a real QR code PNG (base64).
 */
app.get('/api/generate-qris', async (req, res) => {
    const packageType = req.query.package || 'basic';
    const transactionId = `TX-${Date.now()}`;
    const tx = createTransaction(transactionId, packageType);
    
    // Generate a real QR code containing the transaction data
    const qrPayload = JSON.stringify({
        type: 'QRIS_MOCK',
        transactionId,
        amount: tx.amount,
        merchant: 'Photobox Studio'
    });
    
    try {
        const qrisDataUrl = await QRCode.toDataURL(qrPayload, {
            width: 300,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' }
        });

        // Set auto-expire timer
        setTimeout(() => {
            const expired = expireTransaction(transactionId);
            if (expired) {
                console.log(`[TIMEOUT] Transaction ${transactionId} expired after 5 min.`);
                notifyPaymentExpired(transactionId);
            }
        }, PAYMENT_TIMEOUT_MS);

        res.json({ transactionId, qrisUrl: qrisDataUrl, amount: tx.amount, expiresIn: PAYMENT_TIMEOUT_MS });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

/**
 * Simulate Payment Success (Webhook).
 * Now also pushes via WebSocket for instant notification.
 */
app.post('/api/simulate-payment-success', (req, res) => {
    const { transactionId } = req.body;
    
    if (!transactionId) {
        return res.status(400).json({ error: 'transactionId is required' });
    }

    const tx = getTransaction(transactionId);
    if (!tx) {
        return res.status(404).json({ error: 'Transaction not found' });
    }
    if (tx.status === 'EXPIRED') {
        return res.status(410).json({ error: 'Transaction has expired' });
    }
    if (tx.status === 'PAID') {
        return res.status(409).json({ error: 'Transaction already paid' });
    }

    setTransactionStatus(transactionId, 'PAID');
    console.log(`[PAYMENT WEBHOOK] ✅ Transaction ${transactionId} is now PAID!`);

    // Push real-time notification via WebSocket
    notifyPaymentSuccess(transactionId);

    res.json({ success: true, message: `Transaction ${transactionId} set to PAID` });
});

/**
 * Payment Status Polling (fallback for WebSocket).
 */
app.get('/api/payment-status/:transactionId', (req, res) => {
    const { transactionId } = req.params;
    const tx = getTransaction(transactionId);
    
    if (!tx) {
        return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({ transactionId, status: tx.status });
});

// ─── Hardware Controls (Mocked) ─────────────────────────────

app.post('/api/hardware/camera/trigger', (req, res) => {
    console.log('📸 [HARDWARE] Camera triggered!');
    setTimeout(() => {
        res.json({ success: true, message: 'Photo captured' });
    }, 500);
});

app.post('/api/hardware/printer/trigger', (req, res) => {
    const { shouldFail } = req.body || {};
    
    // Allow simulating printer failure for testing error recovery
    if (shouldFail) {
        console.log('🖨️ [HARDWARE] ❌ Printer FAILED (simulated)');
        setTimeout(() => {
            res.status(500).json({ success: false, message: 'Printer paper jam (simulated)' });
        }, 2000);
        return;
    }

    console.log('🖨️ [HARDWARE] Printer triggered!');

    // Check if we are running in mock mode
    if (process.env.MOCK_PRINTER === 'true') {
        setTimeout(() => {
            res.json({ success: true, message: 'Printing finished (mock mode)' });
        }, 3000);
    } else {
        // [REQUIREMENT] SumatraPDF must be installed on the Windows host and available in PATH.
        // Executing SumatraPDF via child process to print the local strip file.
        const pdfFileStr = 'path/to/strip.pdf';
        exec(`SumatraPDF.exe -print-to-default "${pdfFileStr}"`, (error, stdout, stderr) => {
            if (error) {
                console.error(`[PRINTER] Execution error: ${error.message}`);
                return res.status(500).json({ success: false, message: 'SumatraPDF printing failed', error: error.message });
            }
            res.json({ success: true, message: 'Printing via SumatraPDF finished' });
        });
    }
});

// ─── Admin Endpoints ─────────────────────────────────────────

app.get('/api/admin/stats', (req, res) => {
    res.json(getStats());
});

// ─── Frame Management API ────────────────────────────────────

/** Get all frames */
app.get('/api/frames', (req, res) => {
    res.json(getFrames());
});

/** Get single frame */
app.get('/api/frames/:id', (req, res) => {
    const frame = getFrame(req.params.id);
    if (!frame) return res.status(404).json({ error: 'Frame not found' });
    res.json(frame);
});

/** Create a new custom frame */
app.post('/api/admin/frames', (req, res) => {
    const result = addFrame(req.body);
    if (result.error) {
        return res.status(409).json(result);
    }
    console.log(`🖼️ [ADMIN] New frame created: ${result.name} (${result.id})`);
    res.status(201).json(result);
});

/** Update a frame */
app.put('/api/admin/frames/:id', (req, res) => {
    const result = updateFrame(req.params.id, req.body);
    if (!result) return res.status(404).json({ error: 'Frame not found' });
    console.log(`🖼️ [ADMIN] Frame updated: ${result.name}`);
    res.json(result);
});

/** Delete a custom frame (default frames are protected) */
app.delete('/api/admin/frames/:id', (req, res) => {
    const success = deleteFrame(req.params.id);
    if (!success) return res.status(400).json({ error: 'Cannot delete. Frame not found or is a default frame.' });
    console.log(`🖼️ [ADMIN] Frame deleted: ${req.params.id}`);
    res.json({ success: true });
});

// ─── Gallery (Photo Download) API ────────────────────────────

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

/** Upload photos + rendered strip → creates a downloadable gallery */
app.post('/api/gallery', async (req, res) => {
    try {
        const { photos, strip, frameId, packageType } = req.body;
        const galleryId = 'G-' + Date.now();
        const galleryDir = path.join(GALLERIES_DIR, galleryId);
        fs.mkdirSync(galleryDir, { recursive: true });

        const savedPhotos = [];

        // Save individual photos
        if (photos && Array.isArray(photos)) {
            photos.forEach((photo, i) => {
                if (photo && photo.startsWith('data:')) {
                    const base64Data = photo.replace(/^data:image\/\w+;base64,/, '');
                    const filename = `photo-${i + 1}.jpg`;
                    fs.writeFileSync(path.join(galleryDir, filename), base64Data, 'base64');
                    savedPhotos.push(filename);
                }
            });
        }

        let cloudStripUrl = null;

        // Save rendered strip & Upload to Cloud
        if (strip && strip.startsWith('data:')) {
            const ext = strip.includes('png') ? 'png' : 'jpg';
            const base64Data = strip.replace(/^data:image\/\w+;base64,/, '');
            
            // Local Backup
            fs.writeFileSync(path.join(galleryDir, `strip.${ext}`), base64Data, 'base64');

            // Cloud Upload to Supabase
            const cloudPath = `${galleryId}/strip.${ext}`;
            console.log(`☁️ [SUPABASE] Uploading strip for ${galleryId}...`);
            cloudStripUrl = await uploadToSupabase(base64Data, cloudPath, `image/${ext}`);
        }

        // Save metadata
        const meta = {
            galleryId,
            frameId: frameId || 'clean-white',
            packageType: packageType || 'basic',
            photoCount: savedPhotos.length,
            hasStrip: !!strip,
            createdAt: Date.now()
        };
        fs.writeFileSync(path.join(galleryDir, 'meta.json'), JSON.stringify(meta, null, 2));

        // Generate download URL pointing to the new Public Astro Website
        const PUBLIC_DOMAIN = process.env.PUBLIC_DOMAIN || 'https://gallery.yourdomain.com';
        const downloadUrl = `${PUBLIC_DOMAIN}/${galleryId}`;

        // Generate QR code for the download URL
        const qrDataUrl = await QRCode.toDataURL(downloadUrl, {
            width: 280,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' }
        });

        console.log(`📸 [GALLERY] Uploaded ${galleryId} → ${downloadUrl}`);

        res.json({ galleryId, downloadUrl, qrDataUrl, cloudStripUrl });
    } catch (err) {
        console.error('Gallery upload error:', err);
        res.status(500).json({ error: 'Failed to create gallery' });
    }
});

/** Serve gallery download page (mobile-friendly HTML) */
app.get('/gallery/:id', (req, res) => {
    const galleryDir = path.join(GALLERIES_DIR, req.params.id);
    if (!fs.existsSync(galleryDir)) {
        return res.status(404).send('<h1>Gallery not found</h1>');
    }

    const meta = JSON.parse(fs.readFileSync(path.join(galleryDir, 'meta.json'), 'utf-8'));
    const files = fs.readdirSync(galleryDir).filter(f => f !== 'meta.json');
    const baseUrl = `/galleries/${req.params.id}`;

    const photoFiles = files.filter(f => f.startsWith('photo-'));
    const stripFile = files.find(f => f.startsWith('strip.'));

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Photos — Photobox Studio</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Outfit', sans-serif;
            background: #09090b;
            color: #fff;
            min-height: 100vh;
            padding: 24px 16px 40px;
        }
        .header {
            text-align: center;
            margin-bottom: 28px;
        }
        .header h1 {
            font-size: 26px;
            font-weight: 800;
            background: linear-gradient(135deg, #a855f7, #ec4899);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 6px;
        }
        .header p { color: #71717a; font-size: 14px; }
        .section-title {
            font-size: 16px;
            font-weight: 700;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .strip-section {
            background: #18181b;
            border: 1px solid #27272a;
            border-radius: 16px;
            padding: 20px;
            margin-bottom: 20px;
            text-align: center;
        }
        .strip-section img {
            max-width: 260px;
            width: 100%;
            border-radius: 8px;
            margin-bottom: 14px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.5);
        }
        .photo-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
            margin-bottom: 16px;
        }
        .photo-card {
            background: #18181b;
            border: 1px solid #27272a;
            border-radius: 12px;
            overflow: hidden;
        }
        .photo-card img {
            width: 100%;
            aspect-ratio: 4/3;
            object-fit: cover;
            display: block;
        }
        .photo-card .card-footer {
            padding: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .photo-card .card-footer span {
            font-size: 12px;
            color: #a1a1aa;
            font-weight: 600;
        }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 10px 18px;
            border-radius: 10px;
            font-weight: 700;
            font-size: 13px;
            text-decoration: none;
            transition: all 0.2s;
            border: none;
            cursor: pointer;
            font-family: 'Outfit', sans-serif;
        }
        .btn-primary {
            background: linear-gradient(135deg, #9333ea, #db2777);
            color: #fff;
            width: 100%;
            padding: 14px;
            font-size: 15px;
        }
        .btn-small {
            background: #27272a;
            color: #e4e4e7;
            font-size: 11px;
            padding: 6px 12px;
        }
        .btn:active { transform: scale(0.96); }
        .footer {
            text-align: center;
            color: #52525b;
            font-size: 12px;
            margin-top: 28px;
            padding-top: 20px;
            border-top: 1px solid #27272a;
        }
        .badge {
            display: inline-block;
            background: #27272a;
            color: #a855f7;
            font-size: 11px;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 20px;
            margin-bottom: 8px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📸 Your Photos</h1>
        <p>Photobox Studio • ${new Date(meta.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    </div>

    ${stripFile ? `
    <div class="strip-section">
        <div class="section-title">🖼️ Photo Strip (with frame)</div>
        <span class="badge">${meta.frameId}</span>
        <br>
        <img src="${baseUrl}/${stripFile}" alt="Photo Strip" />
        <br>
        <a href="${baseUrl}/${stripFile}" download="photobox-strip.${stripFile.split('.').pop()}" class="btn btn-primary">⬇️ Download Photo Strip</a>
    </div>` : ''}

    <div class="section-title" style="margin-top: 8px;">📷 Individual Photos (${photoFiles.length})</div>
    <div class="photo-grid">
        ${photoFiles.map((f, i) => `
        <div class="photo-card">
            <img src="${baseUrl}/${f}" alt="Photo ${i + 1}" />
            <div class="card-footer">
                <span>Photo ${i + 1}</span>
                <a href="${baseUrl}/${f}" download="photobox-${i + 1}.jpg" class="btn btn-small">⬇️ Save</a>
            </div>
        </div>`).join('')}
    </div>

    <a href="${baseUrl}/${stripFile || photoFiles[0]}" download class="btn btn-primary" style="margin-top: 8px;">⬇️ Download All</a>

    <div class="footer">
        <p>Thank you for using Photobox Studio!</p>
        <p style="margin-top:4px;">📍 This link expires when the kiosk restarts</p>
    </div>
</body>
</html>`);
});

// ─── Server Start ────────────────────────────────────────────

server.listen(PORT, () => {
    const localIP = getLocalIP();
    console.log(`🚀 Photobox Backend v3.1 running at http://localhost:${PORT}`);
    console.log(`🌐 Network: http://${localIP}:${PORT}`);
    console.log(`🔌 WebSocket available at ws://localhost:${PORT}/ws`);
    console.log(`📊 Admin stats at http://localhost:${PORT}/api/admin/stats`);
    console.log(`🖼️ Frames API at http://localhost:${PORT}/api/frames`);
    console.log(`📸 Galleries at http://localhost:${PORT}/galleries/`);
});
