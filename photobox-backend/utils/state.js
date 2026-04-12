/**
 * In-memory state for the Photobox system.
 * Tracks transactions, stats, frames, and admin data.
 */

// ─── Default Frame Templates ─────────────────────────────────
const defaultFrames = [
    {
        id: 'clean-white',
        name: 'Clean White',
        subtitle: 'Minimalist',
        bgColor: '#ffffff',
        photoBorder: '#e8e8e8',
        photoBorderWidth: 2,
        photoRadius: 4,
        textColor: '#555555',
        footerText: 'Photobox Studio',
        accentColor: '#a855f7',
        filter: 'none',
        decorations: 'none',
        isDefault: true
    },
    {
        id: 'vintage-film',
        name: 'Vintage Film',
        subtitle: 'Retro Vibes',
        bgColor: '#f5e6d3',
        photoBorder: '#c9a87c',
        photoBorderWidth: 3,
        photoRadius: 2,
        textColor: '#8b6914',
        footerText: 'KODAK 400  •  Photobox Studio',
        accentColor: '#d97706',
        filter: 'sepia',
        decorations: 'film-sprockets',
        isDefault: true
    },
    {
        id: 'neon-glow',
        name: 'Neon Glow',
        subtitle: 'Cyberpunk',
        bgColor: '#0a0a0a',
        photoBorder: '#06b6d4',
        photoBorderWidth: 2,
        photoRadius: 6,
        textColor: '#06b6d4',
        footerText: '✦ PHOTOBOX STUDIO ✦',
        accentColor: '#d946ef',
        filter: 'none',
        decorations: 'neon-border',
        isDefault: true
    },
    {
        id: 'flower-garden',
        name: 'Flower Garden',
        subtitle: 'Cute & Soft',
        bgColor: '#fff0f5',
        photoBorder: '#f9a8d4',
        photoBorderWidth: 3,
        photoRadius: 10,
        textColor: '#be185d',
        footerText: '🌸 Photobox Studio 🌸',
        accentColor: '#ec4899',
        filter: 'none',
        decorations: 'flowers',
        isDefault: true
    }
];

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
        isDefault: false,
        createdAt: Date.now()
    };

    state.frames.push(frame);
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
    return state.frames[idx];
}

function deleteFrame(id) {
    const idx = state.frames.findIndex(f => f.id === id);
    if (idx === -1) return false;
    if (state.frames[idx].isDefault) return false; // Can't delete defaults
    state.frames.splice(idx, 1);
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
