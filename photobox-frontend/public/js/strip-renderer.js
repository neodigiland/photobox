/**
 * StripRenderer — Canvas-based photo strip/grid renderer.
 * Used by both select-frame (preview) and review (final output).
 * Renders a realistic print-ready photo strip with frame decorations.
 */
window.StripRenderer = {

    // ─── Config ──────────────────────────────────────────────────
    STRIP: { width: 360, photoHeight: 240, padding: 22, gap: 14, footerH: 65 },
    GRID: { width: 540, padding: 22, gap: 12, footerH: 65 },

    /** Calculate full strip height for N photos */
    getStripHeight(n) {
        const c = this.STRIP;
        return c.padding + (c.photoHeight * n) + (c.gap * (n - 1)) + c.gap + c.footerH + c.padding;
    },
    /** Calculate full grid height for N photos (always 2 cols) */
    getGridHeight(n) {
        const c = this.GRID;
        const rows = Math.ceil(n / 2);
        const photoW = (c.width - c.padding * 2 - c.gap) / 2;
        const photoH = photoW * 0.75; // 4:3
        return c.padding + (photoH * rows) + (c.gap * (rows - 1)) + c.gap + c.footerH + c.padding;
    },

    // ─── Main Render ─────────────────────────────────────────────
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Array<string|null>} photos - array of image src (data URL or null for placeholder)
     * @param {object} frame - frame config object from API
     * @param {'basic'|'premium'} packageType
     */
    async render(canvas, photos, frame, packageType) {
        const isGrid = packageType === 'premium';
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        let W, H;
        if (isGrid) {
            W = this.GRID.width;
            H = this.getGridHeight(photos.length);
        } else {
            W = this.STRIP.width;
            H = this.getStripHeight(photos.length);
        }

        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.scale(dpr, dpr);

        // ─── Background ──────────────────────────────────────────
        this._drawBackground(ctx, W, H, frame);

        // ─── Film Sprockets (decoration) ─────────────────────────
        if (frame.decorations === 'film-sprockets') {
            this._drawFilmSprockets(ctx, W, H, frame);
        }

        // ─── Photos ──────────────────────────────────────────────
        const images = await this._loadImages(photos);

        if (isGrid) {
            await this._drawGrid(ctx, images, frame, W, H);
        } else {
            await this._drawStrip(ctx, images, frame, W, H);
        }

        // ─── Neon Border (decoration) ────────────────────────────
        if (frame.decorations === 'neon-border') {
            this._drawNeonBorder(ctx, W, H, frame);
        }

        // ─── Flowers (decoration) ────────────────────────────────
        if (frame.decorations === 'flowers') {
            this._drawFlowers(ctx, W, H, frame);
        }

        // ─── Footer ─────────────────────────────────────────────
        this._drawFooter(ctx, W, H, frame, isGrid);
    },

    // ─── Strip Layout (vertical) ─────────────────────────────────
    _drawStrip(ctx, images, frame, W, H) {
        const c = this.STRIP;
        const photoW = W - c.padding * 2;
        let y = c.padding;

        for (let i = 0; i < images.length; i++) {
            this._drawPhoto(ctx, images[i], c.padding, y, photoW, c.photoHeight, frame);
            y += c.photoHeight + c.gap;
        }
    },

    // ─── Grid Layout (2 columns) ─────────────────────────────────
    _drawGrid(ctx, images, frame, W, H) {
        const c = this.GRID;
        const photoW = (W - c.padding * 2 - c.gap) / 2;
        const photoH = photoW * 0.75;
        let row = 0, col = 0;

        for (let i = 0; i < images.length; i++) {
            const x = c.padding + col * (photoW + c.gap);
            const y = c.padding + row * (photoH + c.gap);
            this._drawPhoto(ctx, images[i], x, y, photoW, photoH, frame);
            col++;
            if (col >= 2) { col = 0; row++; }
        }
    },

    // ─── Draw Single Photo ──────────────────────────────────────
    _drawPhoto(ctx, img, x, y, w, h, frame) {
        const r = frame.photoRadius || 4;
        const bw = frame.photoBorderWidth || 2;

        // Border
        ctx.save();
        ctx.fillStyle = frame.photoBorder || '#e0e0e0';
        this._roundRect(ctx, x - bw, y - bw, w + bw * 2, h + bw * 2, r + bw);
        ctx.fill();
        ctx.restore();

        // Photo clip
        ctx.save();
        this._roundRect(ctx, x, y, w, h, r);
        ctx.clip();

        if (img) {
            // Apply filter
            if (frame.filter === 'sepia') {
                ctx.filter = 'sepia(0.6) contrast(1.05) saturate(0.9)';
            } else if (frame.filter === 'grayscale') {
                ctx.filter = 'grayscale(1)';
            } else if (frame.filter === 'high-contrast') {
                ctx.filter = 'contrast(1.3) saturate(1.2)';
            }

            // Cover fit
            const imgRatio = img.width / img.height;
            const slotRatio = w / h;
            let sx = 0, sy = 0, sw = img.width, sh = img.height;
            if (imgRatio > slotRatio) {
                sw = img.height * slotRatio;
                sx = (img.width - sw) / 2;
            } else {
                sh = img.width / slotRatio;
                sy = (img.height - sh) / 2;
            }
            ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
            ctx.filter = 'none';
        } else {
            // Placeholder gradient
            const grad = ctx.createLinearGradient(x, y, x + w, y + h);
            grad.addColorStop(0, this._adjustBrightness(frame.bgColor, -20));
            grad.addColorStop(1, this._adjustBrightness(frame.bgColor, -40));
            ctx.fillStyle = grad;
            ctx.fillRect(x, y, w, h);

            // Placeholder icon
            ctx.fillStyle = this._adjustBrightness(frame.bgColor, -60);
            ctx.font = 'bold 28px Outfit, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('📷', x + w / 2, y + h / 2);
        }
        ctx.restore();
    },

    // ─── Background ──────────────────────────────────────────────
    _drawBackground(ctx, W, H, frame) {
        // Rounded outer card
        const r = 16;
        ctx.save();
        this._roundRect(ctx, 0, 0, W, H, r);
        ctx.fillStyle = frame.bgColor;
        ctx.fill();

        // Subtle texture for certain frames
        if (frame.bgColor !== '#0a0a0a' && frame.bgColor !== '#000000') {
            ctx.globalAlpha = 0.03;
            for (let i = 0; i < H; i += 3) {
                ctx.fillStyle = '#000';
                ctx.fillRect(0, i, W, 1);
            }
            ctx.globalAlpha = 1;
        }
        ctx.restore();
    },

    // ─── Footer ──────────────────────────────────────────────────
    _drawFooter(ctx, W, H, frame, isGrid) {
        const c = isGrid ? this.GRID : this.STRIP;
        const footerY = H - c.padding - c.footerH;

        ctx.save();
        ctx.fillStyle = frame.textColor;
        ctx.font = '600 13px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(frame.footerText, W / 2, footerY + 10);

        // Date
        const dateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
        ctx.font = '400 11px Outfit, sans-serif';
        ctx.globalAlpha = 0.5;
        ctx.fillText(dateStr, W / 2, footerY + 32);

        // Accent line
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = frame.accentColor;
        ctx.fillRect(W / 2 - 30, footerY + 52, 60, 2);
        ctx.restore();
    },

    // ─── Decorations ─────────────────────────────────────────────

    _drawFilmSprockets(ctx, W, H, frame) {
        ctx.save();
        ctx.fillStyle = '#00000030';
        const sprocketW = 10, sprocketH = 14, gap = 22;
        for (let y = 15; y < H - 15; y += gap) {
            // Left
            this._roundRect(ctx, 5, y, sprocketW, sprocketH, 2);
            ctx.fill();
            // Right
            ctx.beginPath();
            this._roundRect(ctx, W - 15, y, sprocketW, sprocketH, 2);
            ctx.fill();
        }
        ctx.restore();
    },

    _drawNeonBorder(ctx, W, H, frame) {
        ctx.save();
        const r = 16;
        ctx.strokeStyle = frame.photoBorder;
        ctx.lineWidth = 2;
        ctx.shadowColor = frame.photoBorder;
        ctx.shadowBlur = 15;
        this._roundRect(ctx, 3, 3, W - 6, H - 6, r);
        ctx.stroke();

        // Second glow layer with accent
        ctx.strokeStyle = frame.accentColor;
        ctx.shadowColor = frame.accentColor;
        ctx.shadowBlur = 10;
        ctx.lineWidth = 1;
        this._roundRect(ctx, 8, 8, W - 16, H - 16, r - 3);
        ctx.stroke();
        ctx.restore();
    },

    _drawFlowers(ctx, W, H, frame) {
        ctx.save();
        ctx.font = '18px serif';
        ctx.textAlign = 'center';
        const flowers = ['🌸', '🌷', '🌺', '🌼', '💐'];
        const positions = [
            [15, 15], [W - 15, 15], [15, H - 15], [W - 15, H - 15],
            [W / 2, 10], [W / 2, H - 12],
            [10, H / 3], [W - 10, H / 3], [10, H * 2 / 3], [W - 10, H * 2 / 3]
        ];
        positions.forEach((pos, i) => {
            ctx.fillText(flowers[i % flowers.length], pos[0], pos[1]);
        });
        ctx.restore();
    },

    // ─── Utilities ───────────────────────────────────────────────

    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    },

    _loadImages(srcs) {
        return Promise.all(srcs.map(src => {
            if (!src || src.startsWith('mock')) return Promise.resolve(null);
            return new Promise(resolve => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = src;
            });
        }));
    },

    _adjustBrightness(hex, amount) {
        let r = parseInt(hex.slice(1, 3), 16);
        let g = parseInt(hex.slice(3, 5), 16);
        let b = parseInt(hex.slice(5, 7), 16);
        r = Math.max(0, Math.min(255, r + amount));
        g = Math.max(0, Math.min(255, g + amount));
        b = Math.max(0, Math.min(255, b + amount));
        return `rgb(${r},${g},${b})`;
    }
};
