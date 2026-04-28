require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const Jimp = require('jimp');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const { startCleanupCron } = require('./utils/cleanup');
const { uploadToR2 } = require('./utils/r2Upload');
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

// ─── Gallery & Frame Storage Setup ─────────────────────────────
const GALLERIES_DIR = path.join(__dirname, 'galleries');
if (!fs.existsSync(GALLERIES_DIR)) fs.mkdirSync(GALLERIES_DIR);
app.use('/galleries', express.static(GALLERIES_DIR));

const FRAMES_DIR = path.join(__dirname, 'frames');
if (!fs.existsSync(FRAMES_DIR)) fs.mkdirSync(FRAMES_DIR);
app.use('/frames', express.static(FRAMES_DIR));

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

// ─── Hardware Controls ────────────────────────────────────────

// Turn ON DSLR Live Preview
app.post('/api/hardware/camera/liveview/start', async (req, res) => {
    console.log('🎥 [HARDWARE] Waking up DSLR sensor via digiCamControl Webserver...');
    // Return IMMEDIATELY so the frontend doesn't get stuck
    res.json({ success: true, message: 'LiveView starting in background' });
    try {
        await fetch('http://localhost:5513/?CMD=LiveViewWnd_Show');
    } catch (e) {
        console.warn('[CAMERA] Webserver LiveView Start warning:', e.message);
    }
});

// Turn OFF DSLR Live Preview (to prevent sensor overheat)
app.post('/api/hardware/camera/liveview/stop', async (req, res) => {
    console.log('💤 [HARDWARE] Shutting down DSLR sensor via Webserver...');
    // Return IMMEDIATELY
    res.json({ success: true, message: 'LiveView stopping in background' });
    try {
        await fetch('http://localhost:5513/?CMD=LiveViewWnd_Hide');
    } catch (e) {
        console.warn('[CAMERA] Webserver LiveView Stop warning:', e.message);
    }
});

app.post('/api/hardware/camera/trigger', async (req, res) => {
    console.log('📸 [HARDWARE] Triggering physical Canon DSLR via Webserver...');
    
    // Generate unique filename via timestamp
    const fileName = 'foto-' + Date.now() + '.jpg';
    
    // Define absolute save path
    const saveDirectory = path.join(__dirname, 'galleries', 'temp');
    const absoluteSavePath = path.join(saveDirectory, fileName);
    
    // Auto-create directories if they don't exist yet
    if (!fs.existsSync(saveDirectory)) {
        fs.mkdirSync(saveDirectory, { recursive: true });
    }

    // Construct the command exactly as requested
    const command = `"C:\\Program Files (x86)\\digiCamControl\\CameraControlCmd.exe" /capture /filename "${absoluteSavePath}"`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`[CAMERA] Trigger failed: ${error.message}`);
            return res.status(500).json({ success: false, message: 'Camera trigger failed or device offline' });
        }
        
        // Ensure file actually exists before telling frontend it was successful.
        // digiCamControl might exit 0 even if no camera is connected or if capture failed silently.
        if (!fs.existsSync(absoluteSavePath)) {
            console.error(`[CAMERA] Trigger executed but file ${fileName} was not written to disk!`);
            return res.status(500).json({ success: false, message: 'File not written. DSLR disconnected?' });
        }
        
        console.log(`📸 [HARDWARE] Photo captured & saved to ${absoluteSavePath}`);
        
        // Return public static URL
        const photoUrl = `http://localhost:3000/galleries/temp/${fileName}`;
        res.json({ success: true, photoPath: '/galleries/temp/' + fileName, photoUrl: photoUrl });
    });
});

app.post('/api/hardware/printer/trigger', (req, res) => {
    const { shouldFail, copies } = req.body || {};
    const printCount = parseInt(copies) || 1;
    
    // Allow simulating printer failure for testing error recovery
    if (shouldFail) {
        console.log('🖨️ [HARDWARE] ❌ Printer FAILED (simulated)');
        setTimeout(() => {
            res.status(500).json({ success: false, message: 'Printer paper jam (simulated)' });
        }, 2000);
        return;
    }

    console.log(`🖨️ [HARDWARE] Printer triggered! Copies: ${printCount}`);

    // Check if we are running in mock mode
    if (process.env.MOCK_PRINTER === 'true') {
        setTimeout(() => {
            res.json({ success: true, message: `Printing ${printCount} copies finished (mock mode)` });
        }, 3000 * printCount);
        return;
    }

    // ─── REAL PRINTER MODE (BORDERLESS) ─────────────────────────
    // Auto-detect the latest gallery strip image
    let stripFilePath = null;

    try {
        const galleries = fs.readdirSync(GALLERIES_DIR)
            .filter(d => fs.statSync(path.join(GALLERIES_DIR, d)).isDirectory())
            .map(d => ({
                name: d,
                time: fs.statSync(path.join(GALLERIES_DIR, d)).mtimeMs
            }))
            .sort((a, b) => b.time - a.time); // newest first

        for (const g of galleries) {
            const jpgPath = path.join(GALLERIES_DIR, g.name, 'strip.jpg');
            const pngPath = path.join(GALLERIES_DIR, g.name, 'strip.png');
            if (fs.existsSync(jpgPath)) { stripFilePath = jpgPath; break; }
            if (fs.existsSync(pngPath)) { stripFilePath = pngPath; break; }
        }
    } catch (err) {
        console.error('[PRINTER] Failed to scan galleries:', err.message);
    }

    if (!stripFilePath) {
        console.error('[PRINTER] No strip image found in any gallery!');
        return res.status(404).json({ success: false, message: 'No printable image found. Take photos first.' });
    }

    console.log(`🖨️ [PRINTER] File to print: ${stripFilePath}`);
    const printerName = process.env.PRINTER_NAME || '';
    const printScript = path.join(__dirname, 'print-borderless.ps1');

    // ─── Method 1: PowerShell .NET PrintDocument (borderless) ───
    let psArgs = `-ExecutionPolicy Bypass -File "${printScript}" -ImagePath "${stripFilePath}" -Copies ${printCount}`;
    if (printerName) psArgs += ` -PrinterName "${printerName}"`;

    console.log(`🖨️ [PRINTER] Trying Method 1: PowerShell .NET script...`);

    exec(`powershell ${psArgs}`, { timeout: 60000 }, (err1, stdout1, stderr1) => {
        if (stdout1) console.log(stdout1.trim());
        if (stderr1) console.log(stderr1.trim());

        if (!err1) {
            console.log(`🖨️ [PRINTER] ✅ Method 1 OK!`);
            return res.json({ success: true, method: 'powershell-net', message: `Printed ${printCount} copies (borderless)`, file: stripFilePath });
        }

        console.warn(`[PRINTER] Method 1 failed: ${err1.message}`);
        console.log(`🖨️ [PRINTER] Trying Method 2: mspaint...`);

        // ─── Method 2: MS Paint silent print (built-in Windows) ───
        const paintCmd = printerName
            ? `mspaint /pt "${stripFilePath}" "${printerName}"`
            : `mspaint /p "${stripFilePath}"`;

        exec(paintCmd, { timeout: 30000 }, (err2, stdout2, stderr2) => {
            if (!err2) {
                console.log(`🖨️ [PRINTER] ✅ Method 2 OK (mspaint)!`);
                return res.json({ success: true, method: 'mspaint', message: `Printed via MS Paint`, file: stripFilePath });
            }

            console.warn(`[PRINTER] Method 2 failed: ${err2.message}`);
            console.log(`🖨️ [PRINTER] Trying Method 3: Start-Process -Verb Print...`);

            // ─── Method 3: Windows shell verb print (opens default photo viewer) ───
            const shellCmd = `powershell -Command "Start-Process -FilePath '${stripFilePath.replace(/'/g, "''")}' -Verb Print"`;

            exec(shellCmd, { timeout: 30000 }, (err3) => {
                if (!err3) {
                    console.log(`🖨️ [PRINTER] ✅ Method 3 OK (Shell Print)!`);
                    return res.json({ success: true, method: 'shell-print', message: `Printed via Windows Photo Viewer`, file: stripFilePath });
                }

                console.error(`[PRINTER] All 3 methods failed!`);
                return res.status(500).json({
                    success: false,
                    message: 'Gagal mencetak. Pastikan printer tersambung dan di-set sebagai default printer di Windows Settings.',
                    errors: {
                        method1: err1.message,
                        method2: err2.message,
                        method3: err3.message
                    }
                });
            });
        });
    });
});

// ─── Printer Config & Test APIs ──────────────────────────────

/** Get current printer settings & available printers */
app.get('/api/admin/printer/info', (req, res) => {
    // List installed printers via PowerShell
    const psCmd = `powershell -Command "Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus, Type | ConvertTo-Json"`;
    
    exec(psCmd, { timeout: 10000 }, (err, stdout) => {
        let printers = [];
        try {
            if (stdout && stdout.trim()) {
                const parsed = JSON.parse(stdout.trim());
                printers = Array.isArray(parsed) ? parsed : [parsed];
            }
        } catch (e) {
            console.warn('[PRINTER] Could not parse printer list:', e.message);
        }

        res.json({
            currentSettings: {
                mockMode: process.env.MOCK_PRINTER === 'true',
                printerName: process.env.PRINTER_NAME || '(Default Printer)',
                paperSize: process.env.PAPER_SIZE || '4x6',
                quality: process.env.PRINT_QUALITY || 'high',
                colorMode: process.env.COLOR_MODE || 'color'
            },
            installedPrinters: printers,
            paperSizeOptions: [
                { value: '2x6', label: '2×6 inch (Strip Photo)' },
                { value: '4x6', label: '4×6 inch (4R Standard)' },
                { value: '5x7', label: '5×7 inch (5R)' },
                { value: 'A4',  label: 'A4 (210×297mm)' },
                { value: 'A5',  label: 'A5 (148×210mm)' },
                { value: 'A6',  label: 'A6 (105×148mm)' },
                { value: 'auto', label: 'Auto (printer default)' }
            ],
            qualityOptions: [
                { value: 'high',   label: 'High Quality (Best for photos)' },
                { value: 'normal', label: 'Normal' },
                { value: 'draft',  label: 'Draft (Fast, lower quality)' }
            ]
        });
    });
});

/** Test print — prints latest strip with current settings */
app.post('/api/admin/printer/test', (req, res) => {
    const { printerName, paperSize, quality, colorMode, copies } = req.body || {};
    const printCount = parseInt(copies) || 1;

    // Find latest strip
    let stripFilePath = null;
    try {
        const galleries = fs.readdirSync(GALLERIES_DIR)
            .filter(d => fs.statSync(path.join(GALLERIES_DIR, d)).isDirectory())
            .map(d => ({ name: d, time: fs.statSync(path.join(GALLERIES_DIR, d)).mtimeMs }))
            .sort((a, b) => b.time - a.time);

        for (const g of galleries) {
            const jpgPath = path.join(GALLERIES_DIR, g.name, 'strip.jpg');
            const pngPath = path.join(GALLERIES_DIR, g.name, 'strip.png');
            if (fs.existsSync(jpgPath)) { stripFilePath = jpgPath; break; }
            if (fs.existsSync(pngPath)) { stripFilePath = pngPath; break; }
        }
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Gallery scan failed: ' + err.message });
    }

    if (!stripFilePath) {
        return res.status(404).json({ success: false, message: 'Belum ada foto untuk test print. Ambil foto dulu via kiosk.' });
    }

    const pName = printerName || process.env.PRINTER_NAME || '';
    const printScript = path.join(__dirname, 'print-borderless.ps1');

    let psArgs = `-ExecutionPolicy Bypass -File "${printScript}" -ImagePath "${stripFilePath}" -Copies ${printCount}`;
    if (pName) psArgs += ` -PrinterName "${pName}"`;

    console.log(`🖨️ [TEST PRINT] Printer=${pName || 'default'}, File=${stripFilePath}`);

    exec(`powershell ${psArgs}`, { timeout: 60000 }, (error, stdout, stderr) => {
        const log = [stdout, stderr].filter(Boolean).join('\n').trim();
        if (log) console.log(log);
        if (error) {
            console.error(`[TEST PRINT] PowerShell failed: ${error.message}`);
            
            // Fallback: try mspaint
            const paintCmd = pName
                ? `mspaint /pt "${stripFilePath}" "${pName}"`
                : `mspaint /p "${stripFilePath}"`;

            exec(paintCmd, { timeout: 30000 }, (err2) => {
                if (!err2) {
                    return res.json({ success: true, message: 'Test print via MS Paint berhasil!', method: 'mspaint', file: stripFilePath, log: log });
                }
                return res.status(500).json({ success: false, message: 'Test print gagal. Cek apakah printer tersambung.', log: log });
            });
            return;
        }
        res.json({ success: true, message: 'Test print berhasil dikirim!', file: stripFilePath, log: log });
    });
});

/** Open Windows Printer Preferences dialog */
app.post('/api/admin/printer/open-settings', (req, res) => {
    const printerName = req.body.printerName || process.env.PRINTER_NAME || '';
    
    let cmd;
    if (printerName) {
        // Open specific printer preferences
        cmd = `rundll32 printui.dll,PrintUIEntry /e /n "${printerName}"`;
    } else {
        // Open general printer settings
        cmd = `start ms-settings:printers`;
    }
    
    exec(cmd, (error) => {
        if (error) {
            // Fallback: open Control Panel printers
            exec('control printers', () => {});
        }
    });
    
    res.json({ success: true, message: 'Printer settings window opened on server PC' });
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
    try {
        const payload = { ...req.body };

        // Handle Base64 Image Upload
        if (payload.imageBase64) {
            const framesDir = path.join(__dirname, 'frames');
            if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir);

            // Extract base64 part
            const matches = payload.imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const buffer = Buffer.from(matches[2], 'base64');
                // Generate safe filename
                const safeName = payload.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                const filename = `${safeName}-${Date.now()}.png`;
                const absolutePath = path.join(framesDir, filename);
                
                fs.writeFileSync(absolutePath, buffer);
                
                // Set the static overlay URL to be served by the backend
                payload.overlay = `http://localhost:${PORT}/frames/${filename}`;
            }
            delete payload.imageBase64; // Do not save the giant string in state memory
        }

        const result = addFrame(payload);
        if (result.error) {
            return res.status(409).json(result);
        }
        console.log(`🖼️ [ADMIN] New frame created: ${result.name} (${result.id})`);
        res.status(201).json(result);
    } catch (e) {
        console.error('Frame creation failed:', e);
        res.status(500).json({ error: 'Failed to create frame' });
    }
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
                const filename = `photo-${i + 1}.jpg`;
                if (photo && photo.startsWith('data:')) {
                    const base64Data = photo.replace(/^data:image\/\w+;base64,/, '');
                    fs.writeFileSync(path.join(galleryDir, filename), base64Data, 'base64');
                    savedPhotos.push(filename);
                } else if (photo && photo.includes('/galleries/temp/')) {
                    try {
                        const tempFileName = photo.split('/').pop();
                        const sourcePath = path.join(GALLERIES_DIR, 'temp', tempFileName);
                        if (fs.existsSync(sourcePath)) {
                            fs.copyFileSync(sourcePath, path.join(galleryDir, filename));
                            savedPhotos.push(filename);
                        }
                    } catch (err) {
                        console.error('Failed to copy temp file:', err);
                    }
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

            // Cloud Upload to R2 (Await this one immediately so it returns in the API)
            const cloudPath = `${galleryId}/strip.${ext}`;
            console.log(`☁️ [R2] Uploading strip for ${galleryId}...`);
            cloudStripUrl = await uploadToR2(base64Data, cloudPath, `image/${ext}`);
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

        // Background ASYNC WORKER: Process GIF and Upload Raw Photos 
        // We don't await this so the kiosk UI remains fast!
        setTimeout(async () => {
            try {
                // Upload raw photos to R2
                console.log(`☁️ [R2] Background uploading ${savedPhotos.length} raw photos...`);
                for (let i = 0; i < savedPhotos.length; i++) {
                    const sp = savedPhotos[i];
                    const fullPath = path.join(galleryDir, sp);
                    const b64 = fs.readFileSync(fullPath, 'base64');
                    await uploadToR2(b64, `${galleryId}/${sp}`, 'image/jpeg');
                }

                // Generate GIF
                console.log(`🎞️ [GIF ENCODER] Generating GIF for ${galleryId}...`);
                const gifEncoder = new GIFEncoder();
                for (let i = 0; i < savedPhotos.length; i++) {
                    const fullPath = path.join(galleryDir, savedPhotos[i]);
                    const img = await Jimp.read(fullPath);
                    img.resize(400, Jimp.AUTO); // Downscale for optimal GIF size (400px width)
                    const { width, height } = img.bitmap;
                    const palette = quantize(img.bitmap.data, 256);
                    const index = applyPalette(img.bitmap.data, palette);
                    gifEncoder.writeFrame(index, width, height, { palette, delay: 500 }); // 500ms per frame
                }
                gifEncoder.finish();
                const gifBuffer = Buffer.from(gifEncoder.bytes());
                const gifPathLocal = path.join(galleryDir, 'animation.gif');
                fs.writeFileSync(gifPathLocal, gifBuffer);
                
                // Upload GIF to R2
                await uploadToR2(gifBuffer.toString('base64'), `${galleryId}/animation.gif`, 'image/gif');
                console.log(`🎞️☁️ [GIF] Finished & Uploaded animation.gif to R2!`);
            } catch (err) {
                console.error('❌ [BACKGROUND WORKER] Failed to process GIF & Raw uploads:', err.message);
            }
        }, 100);

        // Generate download URL pointing to the new Public Astro Website
        const PUBLIC_DOMAIN = process.env.PUBLIC_DOMAIN || 'https://photobox-three.vercel.app';
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
