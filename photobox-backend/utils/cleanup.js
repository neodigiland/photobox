const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

function startCleanupCron(galleriesDir) {
    // Run daily at 03:00 AM
    cron.schedule('0 3 * * *', () => {
        console.log('[CRON] Starting daily gallery cleanup...');
        if (!fs.existsSync(galleriesDir)) return;

        const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days
        const now = Date.now();
        let deletedCount = 0;

        try {
            const dirs = fs.readdirSync(galleriesDir);
            for (const dirName of dirs) {
                // Galleries are named G-{timestamp}
                if (dirName.startsWith('G-')) {
                    const timestampStr = dirName.substring(2);
                    const timestamp = parseInt(timestampStr, 10);
                    
                    if (!isNaN(timestamp) && (now - timestamp) > maxAgeMs) {
                        const dirPath = path.join(galleriesDir, dirName);
                        fs.rmSync(dirPath, { recursive: true, force: true });
                        console.log(`[CRON] Deleted old gallery: ${dirName}`);
                        deletedCount++;
                    }
                }
            }
            console.log(`[CRON] Cleanup finished. Deleted ${deletedCount} folders.`);
        } catch (err) {
            console.error('[CRON] Error during gallery cleanup:', err);
        }
    });

    console.log('[CRON] Gallery cleanup scheduled at 03:00 daily.');
}

module.exports = { startCleanupCron };
