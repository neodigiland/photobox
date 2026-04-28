/**
 * In-memory state for the Photobox system.
 * Tracks transactions, stats, frames, and admin data.
 */

const fs = require('fs');
const path = require('path');

// ─── Default Frame Templates ─────────────────────────────────
const defaultFrames = [];

const state = {
    transactions: {},
    frames: [...defaultFrames],
    stats: {
        totalSessions: 0,
        totalRevenue: 0,
        packageCounts: { basic: 0, premium: 0 },
        dailyHistory: []
    }
};

// ─── Persistence ─────────────────────────────────────────────
const FRAMES_FILE = path.join(__dirname, '..', 'frames.json');

function loadPersistentFrames() {
    try {
        if (fs.existsSync(FRAMES_FILE)) {
            const data = fs.readFileSync(FRAMES_FILE, 'utf-8');
            const customFrames = JSON.parse(data);
            if (Array.isArray(customFrames)) {
                state.frames = [...defaultFrames, ...customFrames];
                console.log(`[STATE] Loaded ${customFrames.length} custom frames from disk.`);
            }
        }
    } catch (err) {
        console.error('[STATE] Failed to load custom frames:', err.message);
    }
}

function savePersistentFrames() {
    try {
        const customFrames = state.frames.filter(f => !f.isDefault);
        fs.writeFileSync(FRAMES_FILE, JSON.stringify(customFrames, null, 2));
    } catch (err) {
        console.error('[STATE] Failed to save custom frames:', err.message);
    }
}

// Initialize persistence
loadPersistentFrames();

// ─── Transaction Methods ─────────────────────────────────────

function createTransaction(transactionId, packageType) {
    const amount = packageType === 'premium' ? 45000 : 30000;
    state.transactions[transactionId] = {
        status: 'PENDING',
        package: packageType,
        amount,
        createdAt: Date.now(),
        paidAt: null
    };
    return state.transactions[transactionId];
}

function getTransaction(transactionId) {
    return state.transactions[transactionId] || null;
}

function getTransactionStatus(transactionId) {
    const tx = state.transactions[transactionId];
    return tx ? tx.status : null;
}

function setTransactionStatus(transactionId, status) {
    if (state.transactions[transactionId]) {
        state.transactions[transactionId].status = status;
        if (status === 'PAID') {
            const tx = state.transactions[transactionId];
            tx.paidAt = Date.now();
            state.stats.totalSessions++;
            state.stats.totalRevenue += tx.amount;
            state.stats.packageCounts[tx.package] =
                (state.stats.packageCounts[tx.package] || 0) + 1;
            const today = new Date().toISOString().split('T')[0];
            let dayEntry = state.stats.dailyHistory.find(d => d.date === today);
            if (!dayEntry) {
                dayEntry = { date: today, sessions: 0, revenue: 0 };
                state.stats.dailyHistory.push(dayEntry);
            }
            dayEntry.sessions++;
            dayEntry.revenue += tx.amount;
        }
    }
}

function expireTransaction(transactionId) {
    if (state.transactions[transactionId] && state.transactions[transactionId].status === 'PENDING') {
        state.transactions[transactionId].status = 'EXPIRED';
        return true;
    }
    return false;
}

// ─── Frame Methods ───────────────────────────────────────────

function getFrames() {
    return state.frames;
}

function getFrame(id) {
    return state.frames.find(f => f.id === id) || null;
}

function addFrame(frameData) {
    // Generate ID from name
    const id = frameData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    
    // Check for duplicate
    if (state.frames.find(f => f.id === id)) {
        return { error: 'A frame with this name already exists' };
    }

    const frame = {
        id,
        name: frameData.name,
        subtitle: frameData.subtitle || 'Custom',
        bgColor: frameData.bgColor || '#ffffff',
        photoBorder: frameData.photoBorder || '#e0e0e0',
        photoBorderWidth: parseInt(frameData.photoBorderWidth) || 2,
        photoRadius: parseInt(frameData.photoRadius) || 4,
        textColor: frameData.textColor || '#333333',
        footerText: frameData.footerText || 'Photobox Studio',
        accentColor: frameData.accentColor || '#a855f7',
        filter: frameData.filter || 'none',
        decorations: frameData.decorations || 'none',
        layout: frameData.layout || null,  // New custom dynamic layout coordinates [{x,y,w,h}]
        overlay: frameData.overlay || null, // New absolute URL for transparent PNG overlay
        packageType: frameData.packageType || 'basic', // 'basic' = Strip, 'premium' = 4R
        isDefault: false,
        createdAt: Date.now()
    };

    state.frames.push(frame);
    savePersistentFrames();
    return frame;
}

function updateFrame(id, frameData) {
    const idx = state.frames.findIndex(f => f.id === id);
    if (idx === -1) return null;
    
    // Preserve id and isDefault
    state.frames[idx] = {
        ...state.frames[idx],
        ...frameData,
        id: state.frames[idx].id,
        isDefault: state.frames[idx].isDefault
    };
    savePersistentFrames();
    return state.frames[idx];
}

function deleteFrame(id) {
    const idx = state.frames.findIndex(f => f.id === id);
    if (idx === -1) return false;
    if (state.frames[idx].isDefault) return false; // Can't delete defaults
    state.frames.splice(idx, 1);
    savePersistentFrames();
    return true;
}

// ─── Stats Methods ───────────────────────────────────────────

function getStats() {
    return {
        ...state.stats,
        totalFrames: state.frames.length,
        customFrames: state.frames.filter(f => !f.isDefault).length,
        activePending: Object.values(state.transactions).filter(t => t.status === 'PENDING').length,
        recentTransactions: Object.entries(state.transactions)
            .map(([id, tx]) => ({ id, ...tx }))
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 20)
    };
}

module.exports = {
    createTransaction, getTransaction, getTransactionStatus,
    setTransactionStatus, expireTransaction,
    getFrames, getFrame, addFrame, updateFrame, deleteFrame,
    getStats
};
