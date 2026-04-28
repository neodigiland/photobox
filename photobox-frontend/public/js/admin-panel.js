/**
 * Admin Panel — Premium Controller
 * Handles stats, frame CRUD, visual editor, and gallery management.
 */
const BACKEND_URL = 'http://localhost:3000';

// ─── STATE ───────────────────────────────────────────────────
let uploadedBase64 = null;
let isDragging = false;
let isResizing = false;
let activeBlock = null;
let startX, startY, startW, startH, startMouseX, startMouseY;
let layoutBlocks = [
    { id: 1, x: 8.33, y: 5.55, w: 83.33, h: 27.77, rotation: 0 },
    { id: 2, x: 8.33, y: 36.11, w: 83.33, h: 27.77, rotation: 0 },
    { id: 3, x: 8.33, y: 66.66, w: 83.33, h: 27.77, rotation: 0 }
];
let allFramesData = [];
let editingFrameId = null;
let currentTab = 'dashboard';
let copiedBlockSize = null; // { w, h, rotation } — clipboard for block dimensions

// ─── NAVIGATION ──────────────────────────────────────────────
function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('[data-page]').forEach(p => {
        if (p.dataset.page === tab) { p.classList.remove('hidden'); } 
        else { p.classList.add('hidden'); }
    });
    document.querySelectorAll('[data-nav]').forEach(n => {
        if (n.dataset.nav === tab) { n.classList.add('nav-active'); }
        else { n.classList.remove('nav-active'); }
    });
    // Update topbar title
    const titles = { dashboard: '📊 Dashboard', frames: '🖼️ Frame Manager', transactions: '💳 Transaksi', printer: '🖨️ Printer Settings' };
    const topTitle = document.getElementById('topbar-title');
    if (topTitle) topTitle.textContent = titles[tab] || 'Dashboard';

    // Reload data when switching
    if (tab === 'dashboard') loadStats();
    if (tab === 'frames') loadFrames();
    if (tab === 'transactions') loadTransactions();
    if (tab === 'printer') loadPrinterInfo();
}

// ─── STATS ───────────────────────────────────────────────────
async function loadStats() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/admin/stats`);
        const s = await res.json();
        document.getElementById('stat-sessions').textContent = s.totalSessions || 0;
        document.getElementById('stat-revenue').textContent = 'Rp ' + (s.totalRevenue || 0).toLocaleString('id-ID');
        document.getElementById('stat-basic').textContent = s.packageCounts?.basic || 0;
        document.getElementById('stat-premium').textContent = s.packageCounts?.premium || 0;
        document.getElementById('stat-pending').textContent = s.activePending || 0;
        document.getElementById('stat-frames').textContent = s.totalFrames || 0;
        renderTransactions(s.recentTransactions || [], 'tx-body');
    } catch (err) {
        console.error('Stats load failed:', err);
    }
}

async function loadTransactions() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/admin/stats`);
        const s = await res.json();
        renderTransactions(s.recentTransactions || [], 'tx-body-full');
    } catch (err) {
        console.error('Transactions load failed:', err);
    }
}

function renderTransactions(txs, targetId) {
    const tbody = document.getElementById(targetId);
    if (!tbody) return;
    if (txs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding:40px;text-align:center;color:#71717a;">Belum ada transaksi</td></tr>';
        return;
    }
    tbody.innerHTML = txs.map(tx => {
        const statusColor = tx.status === 'PAID' ? 'text-emerald-400 bg-emerald-500/10' : tx.status === 'PENDING' ? 'text-amber-400 bg-amber-500/10' : 'text-red-400 bg-red-500/10';
        const scBg = tx.status === 'PAID' ? 'background:rgba(52,211,153,0.1);color:#34d399;' : tx.status === 'PENDING' ? 'background:rgba(251,191,36,0.1);color:#fbbf24;' : 'background:rgba(248,113,113,0.1);color:#f87171;';
        const pkgLabel = tx.package === 'premium' ? '4R Penuh' : 'Strip';
        const pkgBg = tx.package === 'premium' ? 'background:rgba(244,114,182,0.1);color:#f472b6;' : 'background:rgba(168,85,247,0.1);color:#a855f7;';
        const time = new Date(tx.createdAt).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
        const validateBtn = tx.status === 'PENDING' 
            ? `<button onclick="validatePayment('${tx.id}')" style="padding:5px 12px;border-radius:8px;font-size:11px;font-weight:700;background:rgba(52,211,153,0.15);color:#34d399;border:1px solid rgba(52,211,153,0.25);cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='rgba(52,211,153,0.3)'" onmouseout="this.style.background='rgba(52,211,153,0.15)'">✅ Validasi</button>` 
            : `<span style="color:#3f3f46;font-size:11px;">—</span>`;
        return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
            <td style="padding:12px 16px;"><span style="font-family:monospace;font-size:12px;color:#a1a1aa;">${tx.id}</span></td>
            <td style="padding:12px 16px;"><span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;${pkgBg}">${pkgLabel}</span></td>
            <td style="padding:12px 16px;font-weight:600;font-size:13px;">Rp ${tx.amount?.toLocaleString('id-ID') || '0'}</td>
            <td style="padding:12px 16px;"><span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;${scBg}">${tx.status}</span></td>
            <td style="padding:12px 16px;font-size:12px;color:#71717a;">${time}</td>
            <td style="padding:12px 16px;">${validateBtn}</td>
        </tr>`;
    }).join('');
}

// Validate a pending transaction
async function validatePayment(txId) {
    if (!confirm(`Validasi pembayaran ${txId}?\nIni akan mengubah status menjadi PAID dan memulai sesi foto.`)) return;
    try {
        const res = await fetch(`${BACKEND_URL}/api/simulate-payment-success`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactionId: txId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Validation failed');
        showToast(`Pembayaran ${txId} berhasil divalidasi!`, 'success');
        loadStats();
        loadTransactions();
    } catch (err) {
        showToast('Gagal validasi: ' + err.message, 'error');
    }
}
window.validatePayment = validatePayment;

// ─── FRAMES ──────────────────────────────────────────────────
async function loadFrames() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/frames`);
        const frames = await res.json();
        allFramesData = frames;
        renderFrameList(frames);
    } catch (err) {
        console.error('Frame load error:', err);
        const fb = document.getElementById('frame-list-basic');
        const fp = document.getElementById('frame-list-premium');
        if (fb) fb.innerHTML = '<p style="color:#f87171;grid-column:1/-1;text-align:center;padding:32px;">Gagal memuat frame — backend offline?</p>';
        if (fp) fp.innerHTML = '<p style="color:#f87171;grid-column:1/-1;text-align:center;padding:32px;">Gagal memuat frame</p>';
    }
}

function renderFrameList(frames) {
    const gridBasic = document.getElementById('frame-list-basic');
    const gridPremium = document.getElementById('frame-list-premium');
    if (!gridBasic || !gridPremium) return;
    gridBasic.innerHTML = '';
    gridPremium.innerHTML = '';

    let basicCount = 0, premiumCount = 0;

    for (const frame of frames) {
        const card = document.createElement('div');
        card.className = 'frame-card group';
        const isOverlay = !!frame.overlay;
        const visual = isOverlay
            ? `<div class="frame-thumb"><img src="${frame.overlay}" style="width:100%;height:100%;object-fit:cover;" loading="lazy"></div>`
            : `<div class="frame-thumb" style="display:flex;align-items:center;justify-content:center;"><span style="color:#52525b;font-size:11px;font-family:monospace;">Legacy</span></div>`;
        const blockCount = frame.layout ? frame.layout.length : '—';
        const maxPhoto = frame.layout && frame.layout.length > 0 ? Math.max(...frame.layout.map(b => b.id)) : '—';

        card.innerHTML = `
            ${visual}
            <div style="padding:12px;display:flex;flex-direction:column;gap:6px;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <span style="font-weight:700;font-size:13px;color:#fafafa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${frame.name}</span>
                    ${frame.isDefault ? '<span class="badge-default">DEF</span>' : '<span class="badge-custom">CUST</span>'}
                </div>
                <div style="display:flex;gap:12px;font-size:11px;color:#71717a;">
                    <span>🧩 ${blockCount} blok</span>
                    <span>📷 ${maxPhoto} foto</span>
                </div>
                ${!frame.isDefault ? `
                <div style="display:flex;gap:6px;padding-top:4px;">
                    <button class="btn-edit" onclick="editFrameAction('${frame.id}')">✏️ Edit</button>
                    <button class="btn-delete" onclick="deleteFrameAction('${frame.id}')">🗑️ Hapus</button>
                </div>` : ''}
            </div>`;

        if (frame.packageType === 'premium') { gridPremium.appendChild(card); premiumCount++; }
        else { gridBasic.appendChild(card); basicCount++; }
    }

    if (basicCount === 0) gridBasic.innerHTML = '<p style="color:#52525b;grid-column:1/-1;text-align:center;padding:40px 0;">Belum ada frame Strip</p>';
    if (premiumCount === 0) gridPremium.innerHTML = '<p style="color:#52525b;grid-column:1/-1;text-align:center;padding:40px 0;">Belum ada frame 4R</p>';
}

async function deleteFrameAction(frameId) {
    if (!confirm('Hapus frame ini? Aksi tidak bisa dibatalkan.')) return;
    try {
        await fetch(`${BACKEND_URL}/api/admin/frames/${frameId}`, { method: 'DELETE' });
        showToast('Frame berhasil dihapus', 'success');
        loadFrames();
        loadStats();
    } catch (err) {
        showToast('Gagal menghapus: ' + err.message, 'error');
    }
}
window.deleteFrameAction = deleteFrameAction;

async function editFrameAction(frameId) {
    const frame = allFramesData.find(f => f.id === frameId);
    if (!frame) return;
    editingFrameId = frameId;
    openModal('Edit Template — ' + frame.name);
    document.getElementById('f-name').value = frame.name;
    document.getElementById('f-package').value = frame.packageType || 'basic';
    uploadedBase64 = frame.overlay;
    const preview = document.getElementById('overlay-preview');
    preview.src = uploadedBase64;
    preview.classList.remove('hidden');
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('drag-zone').classList.remove('hidden');
    layoutBlocks = JSON.parse(JSON.stringify(frame.layout || []));
    renderBlocks();
    updateReadout();
}
window.editFrameAction = editFrameAction;

// ─── MODAL ───────────────────────────────────────────────────
function openModal(title) {
    const modal = document.getElementById('frame-modal');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => modal.classList.add('modal-visible'));
    document.getElementById('modal-title').textContent = title || 'Buat Template Baru';
}

function closeModal() {
    const modal = document.getElementById('frame-modal');
    modal.classList.remove('modal-visible');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

function resetEditor() {
    editingFrameId = null;
    document.getElementById('f-name').value = '';
    const fImage = document.getElementById('f-image');
    if (fImage) fImage.value = '';
    document.getElementById('f-package').value = 'basic';
    document.getElementById('empty-state').style.display = 'flex';
    document.getElementById('overlay-preview').classList.add('hidden');
    document.getElementById('drag-zone').classList.add('hidden');
    uploadedBase64 = null;
    layoutBlocks = [
        { id: 1, x: 8.33, y: 5.55, w: 83.33, h: 27.77, rotation: 0 },
        { id: 2, x: 8.33, y: 36.11, w: 83.33, h: 27.77, rotation: 0 },
        { id: 3, x: 8.33, y: 66.66, w: 83.33, h: 27.77, rotation: 0 }
    ];
    renderBlocks();
    updateReadout();
}

// ─── TOAST ───────────────────────────────────────────────────
function showToast(message, type) {
    type = type || 'info';
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    toast.innerHTML = '<span>' + icon + '</span> <span>' + message + '</span>';
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ─── VISUAL EDITOR ───────────────────────────────────────────
function updateReadout() {
    const r = document.getElementById('coord-readout');
    if (!r) return;
    r.innerHTML = layoutBlocks.map(b =>
        '<div class="readout-row"><span class="readout-id">P' + b.id + '</span> X:' + b.x.toFixed(1) + ' Y:' + b.y.toFixed(1) + ' W:' + b.w.toFixed(1) + ' H:' + b.h.toFixed(1) + ' R:' + (b.rotation || 0) + '°</div>'
    ).join('');
}

function renderBlocks() {
    const dz = document.getElementById('drag-zone');
    if (!dz) return;
    dz.innerHTML = '';
    layoutBlocks.forEach(function(b, idx) {
        const block = document.createElement('div');
        block.className = 'editor-block group';
        block.style.left = b.x + '%';
        block.style.top = b.y + '%';
        block.style.width = b.w + '%';
        block.style.height = b.h + '%';
        block.dataset.id = b.id;
        block.innerHTML = '<span class="block-label" style="transform:rotate(' + (b.rotation || 0) + 'deg)">' + b.id + '</span>' +
            '<div class="copy-handle" title="Copy ukuran blok ini">📋</div>' +
            '<div class="rotate-handle" title="Rotate 90°">↺</div>' +
            '<div class="resize-handle"></div>';
        block.addEventListener('mousedown', function(e) {
            if (e.target.classList.contains('copy-handle')) {
                copiedBlockSize = { w: b.w, h: b.h, rotation: b.rotation || 0 };
                showToast('Ukuran blok P' + b.id + ' disalin! (' + b.w.toFixed(1) + '×' + b.h.toFixed(1) + ')', 'success');
                e.stopPropagation(); e.preventDefault(); return;
            }
            if (e.target.classList.contains('rotate-handle')) {
                b.rotation = ((b.rotation || 0) + 90) % 360;
                renderBlocks(); updateReadout();
                e.stopPropagation(); e.preventDefault(); return;
            }
            if (e.target.classList.contains('resize-handle')) { isResizing = true; } else { isDragging = true; }
            activeBlock = b;
            var rect = dz.getBoundingClientRect();
            startMouseX = e.clientX; startMouseY = e.clientY;
            startX = (b.x / 100) * rect.width; startY = (b.y / 100) * rect.height;
            startW = (b.w / 100) * rect.width; startH = (b.h / 100) * rect.height;
            e.stopPropagation(); e.preventDefault();
        });
        dz.appendChild(block);
    });
}

document.addEventListener('mousemove', function(e) {
    if (!activeBlock || (!isDragging && !isResizing)) return;
    var dz = document.getElementById('drag-zone');
    if (!dz) return;
    var rect = dz.getBoundingClientRect();
    var dx = e.clientX - startMouseX;
    var dy = e.clientY - startMouseY;
    if (isDragging) {
        activeBlock.x = Math.max(0, Math.min((startX + dx) / rect.width * 100, 100 - activeBlock.w));
        activeBlock.y = Math.max(0, Math.min((startY + dy) / rect.height * 100, 100 - activeBlock.h));
    } else if (isResizing) {
        activeBlock.w = Math.max(5, Math.min((startW + dx) / rect.width * 100, 100 - activeBlock.x));
        activeBlock.h = Math.max(5, Math.min((startH + dy) / rect.height * 100, 100 - activeBlock.y));
    }
    renderBlocks(); updateReadout();
});

document.addEventListener('mouseup', function() { isDragging = false; isResizing = false; activeBlock = null; });

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
    // Load initial data
    loadStats();
    loadFrames();

    // Navigation clicks
    var navItems = document.querySelectorAll('[data-nav]');
    for (var i = 0; i < navItems.length; i++) {
        (function(navEl) {
            navEl.addEventListener('click', function() {
                switchTab(navEl.getAttribute('data-nav'));
            });
        })(navItems[i]);
    }

    // Add frame button
    var addBtn = document.getElementById('add-frame-btn');
    if (addBtn) addBtn.addEventListener('click', function() {
        resetEditor();
        openModal('Buat Template Baru');
    });

    // Close/Cancel modal
    var closeBtn = document.getElementById('close-modal');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    var cancelBtn = document.getElementById('cancel-modal');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    // Refresh
    var refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', function() {
        loadStats(); loadFrames(); showToast('Data di-refresh', 'success');
    });

    // Add block
    var addBlockBtn = document.getElementById('add-block-btn');
    if (addBlockBtn) addBlockBtn.addEventListener('click', function() {
        if (!uploadedBase64) return showToast('Upload gambar frame dulu!', 'error');
        var maxId = 0;
        layoutBlocks.forEach(function(b) { if (b.id > maxId) maxId = b.id; });
        var photoNum = prompt('Nomor Foto untuk blok ini (1, 2, 3...)\nUntuk duplikasi foto, masukkan nomor yang sama.', maxId + 1);
        if (!photoNum) return;
        photoNum = parseInt(photoNum);
        if (isNaN(photoNum) || photoNum < 1) return showToast('Nomor foto tidak valid', 'error');
        var newW = copiedBlockSize ? copiedBlockSize.w : 25;
        var newH = copiedBlockSize ? copiedBlockSize.h : 25;
        var newR = copiedBlockSize ? copiedBlockSize.rotation : 0;
        layoutBlocks.push({ id: photoNum, x: 10, y: 10, w: newW, h: newH, rotation: newR });
        if (copiedBlockSize) showToast('Blok baru dibuat dengan ukuran yang disalin!', 'info');
        renderBlocks(); updateReadout();
    });

    // Remove block
    var removeBlockBtn = document.getElementById('remove-block-btn');
    if (removeBlockBtn) removeBlockBtn.addEventListener('click', function() {
        if (!uploadedBase64) return;
        if (layoutBlocks.length > 1) { layoutBlocks.pop(); renderBlocks(); updateReadout(); }
        else showToast('Minimal harus ada 1 blok foto!', 'error');
    });

    // Reset layout
    var resetBtn = document.getElementById('reset-layout-btn');
    if (resetBtn) resetBtn.addEventListener('click', function() {
        layoutBlocks = [
            { id: 1, x: 8.33, y: 5.55, w: 83.33, h: 27.77, rotation: 0 },
            { id: 2, x: 8.33, y: 36.11, w: 83.33, h: 27.77, rotation: 0 },
            { id: 3, x: 8.33, y: 66.66, w: 83.33, h: 27.77, rotation: 0 }
        ];
        renderBlocks(); updateReadout();
    });

    // Image upload
    var fImage = document.getElementById('f-image');
    if (fImage) fImage.addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(event) {
            uploadedBase64 = event.target.result;
            var preview = document.getElementById('overlay-preview');
            preview.src = uploadedBase64;
            preview.classList.remove('hidden');
            document.getElementById('empty-state').style.display = 'none';
            document.getElementById('drag-zone').classList.remove('hidden');
            renderBlocks(); updateReadout();
        };
        reader.readAsDataURL(file);
    });

    // Save frame
    var saveBtn = document.getElementById('save-frame-btn');
    if (saveBtn) saveBtn.addEventListener('click', async function() {
        var name = document.getElementById('f-name').value.trim();
        if (!name) return showToast('Masukkan nama frame', 'error');
        if (!uploadedBase64) return showToast('Upload gambar frame dulu', 'error');
        var pkgType = document.getElementById('f-package').value;
        var btn = document.getElementById('save-frame-btn');
        btn.disabled = true;
        btn.textContent = '⏳ Menyimpan...';
        try {
            var method = editingFrameId ? 'PUT' : 'POST';
            var endpoint = editingFrameId ? BACKEND_URL + '/api/admin/frames/' + editingFrameId : BACKEND_URL + '/api/admin/frames';
            var res = await fetch(endpoint, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, subtitle: 'Dynamic Frame', imageBase64: uploadedBase64, packageType: pkgType, layout: layoutBlocks })
            });
            var data = await res.json();
            if (data.error) throw new Error(data.error);
            closeModal();
            loadFrames();
            loadStats();
            showToast('Frame "' + name + '" berhasil disimpan!', 'success');
        } catch (err) {
            showToast('Gagal menyimpan: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '💾 Simpan Template';
        }
    });

    // ─── PRINTER MANAGEMENT ──────────────────────────────────
    var testPrintBtn = document.getElementById('test-print-btn');
    if (testPrintBtn) testPrintBtn.addEventListener('click', testPrint);

    var openSettingsBtn = document.getElementById('open-printer-settings-btn');
    if (openSettingsBtn) openSettingsBtn.addEventListener('click', openPrinterSettings);
});

// ─── PRINTER FUNCTIONS ───────────────────────────────────────
async function loadPrinterInfo() {
    try {
        const res = await fetch(BACKEND_URL + '/api/admin/printer/info');
        const data = await res.json();

        // Render current settings
        const currentEl = document.getElementById('printer-current');
        if (currentEl) {
            const s = data.currentSettings;
            currentEl.innerHTML = `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div style="padding:10px 14px;background:var(--bg);border-radius:8px;border:1px solid var(--border);">
                        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Mode</div>
                        <div style="font-weight:700;font-size:14px;color:${s.mockMode ? 'var(--amber)' : 'var(--green)'}">${s.mockMode ? '🔶 MOCK (Simulasi)' : '🟢 REAL PRINTER'}</div>
                    </div>
                    <div style="padding:10px 14px;background:var(--bg);border-radius:8px;border:1px solid var(--border);">
                        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Printer</div>
                        <div style="font-weight:600;font-size:13px;">${s.printerName}</div>
                    </div>
                    <div style="padding:10px 14px;background:var(--bg);border-radius:8px;border:1px solid var(--border);">
                        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Kertas</div>
                        <div style="font-weight:600;font-size:13px;">${s.paperSize}</div>
                    </div>
                    <div style="padding:10px 14px;background:var(--bg);border-radius:8px;border:1px solid var(--border);">
                        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Kualitas</div>
                        <div style="font-weight:600;font-size:13px;">${s.quality}</div>
                    </div>
                </div>
            `;
        }

        // Render installed printers
        const listEl = document.getElementById('printer-list');
        if (listEl) {
            if (data.installedPrinters.length === 0) {
                listEl.innerHTML = '<p style="color:var(--text3);font-size:13px;">Tidak ada printer terdeteksi</p>';
            } else {
                listEl.innerHTML = data.installedPrinters.map(function(p) {
                    var statusColor = p.PrinterStatus === 0 ? 'var(--green)' : 'var(--amber)';
                    var statusText = p.PrinterStatus === 0 ? 'Ready' : 'Offline';
                    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg);border-radius:8px;border:1px solid var(--border);">' +
                        '<div><div style="font-weight:600;font-size:13px;">' + p.Name + '</div>' +
                        '<div style="font-size:11px;color:var(--text3);">' + (p.DriverName || '') + '</div></div>' +
                        '<span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:rgba(52,211,153,0.1);color:' + statusColor + ';">' + statusText + '</span></div>';
                }).join('');
            }
        }

        // Populate dropdowns
        var tpPrinter = document.getElementById('tp-printer');
        if (tpPrinter) {
            tpPrinter.innerHTML = '<option value="">Default Printer</option>';
            data.installedPrinters.forEach(function(p) {
                tpPrinter.innerHTML += '<option value="' + p.Name + '">' + p.Name + '</option>';
            });
        }

        var tpPaper = document.getElementById('tp-paper');
        if (tpPaper) {
            tpPaper.innerHTML = '';
            data.paperSizeOptions.forEach(function(o) {
                var selected = o.value === data.currentSettings.paperSize ? ' selected' : '';
                tpPaper.innerHTML += '<option value="' + o.value + '"' + selected + '>' + o.label + '</option>';
            });
        }

        var tpQuality = document.getElementById('tp-quality');
        if (tpQuality) {
            tpQuality.innerHTML = '';
            data.qualityOptions.forEach(function(o) {
                var selected = o.value === data.currentSettings.quality ? ' selected' : '';
                tpQuality.innerHTML += '<option value="' + o.value + '"' + selected + '>' + o.label + '</option>';
            });
        }

        var tpColor = document.getElementById('tp-color');
        if (tpColor) tpColor.value = data.currentSettings.colorMode;

    } catch (err) {
        console.error('Printer info load failed:', err);
        var currentEl = document.getElementById('printer-current');
        if (currentEl) currentEl.innerHTML = '<p style="color:var(--red);font-size:13px;">Gagal memuat info printer — backend offline?</p>';
    }
}

async function testPrint() {
    var btn = document.getElementById('test-print-btn');
    var status = document.getElementById('test-print-status');
    var logEl = document.getElementById('test-print-log');

    btn.disabled = true;
    btn.textContent = '⏳ Mengirim ke printer...';
    status.textContent = '';
    status.style.color = 'var(--text3)';

    try {
        var res = await fetch(BACKEND_URL + '/api/admin/printer/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                printerName: document.getElementById('tp-printer').value,
                paperSize: document.getElementById('tp-paper').value,
                quality: document.getElementById('tp-quality').value,
                colorMode: document.getElementById('tp-color').value,
                copies: 1
            })
        });
        var data = await res.json();

        if (data.success) {
            status.textContent = '✅ ' + data.message;
            status.style.color = 'var(--green)';
            showToast('Test print berhasil dikirim!', 'success');
        } else {
            status.textContent = '❌ ' + data.message;
            status.style.color = 'var(--red)';
            showToast('Test print gagal: ' + data.message, 'error');
        }

        if (data.log) {
            logEl.style.display = 'block';
            logEl.textContent = data.log;
        }
    } catch (err) {
        status.textContent = '❌ Error: ' + err.message;
        status.style.color = 'var(--red)';
        showToast('Test print error', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '🖨️ Test Print 1 Lembar';
    }
}

async function openPrinterSettings() {
    try {
        var printerName = document.getElementById('tp-printer').value;
        await fetch(BACKEND_URL + '/api/admin/printer/open-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ printerName: printerName })
        });
        showToast('Jendela Printer Settings dibuka di PC server', 'info');
    } catch (err) {
        showToast('Gagal membuka settings: ' + err.message, 'error');
    }
}
