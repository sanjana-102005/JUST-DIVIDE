/**
 * main.js — Just Divide (Kid Mode)
    * A simple division puzzle game built with Phaser 3.
 */

// -------------------------------------------------------
// CONFIG
// -------------------------------------------------------
const CONFIG = {
    width: 1440,
    height: 1024,
    colors: {
        text: '#333333',
        panelBg: 0xffcc80,
        panelBorder: 0xe6b062,
        slotBg: 0x3fc3c3,
        slotBorder: 0xffffff
    },
    grid: {
        rows: 4,
        cols: 4,
        cellSize: 130,
        gap: 15
    },
    MAX_UNDO: 10
};

// -------------------------------------------------------
// BOOT SCENE (Loads Assets)
// -------------------------------------------------------
class BootScene extends Phaser.Scene {
    constructor() { super('BootScene'); }

    preload() {
        const path = 'assets/';

        this.load.image('bg_desktop', path + 'Desktop_JustDivide_Game_2.png');
        this.load.image('cat', path + 'Cat.png');
        this.load.image('badge', path + 'Levels and Score.png');
        this.load.image('slot', path + 'Placement_Box.png');
        this.load.image('trash', path + 'trash.png');

        // Tiles
        this.load.image('tile_blue', path + 'blue.png');
        this.load.image('tile_orange', path + 'orange.png');
        this.load.image('tile_pink', path + 'pink.png');
        this.load.image('tile_purple', path + 'purpule.png');
    }

    create() {
        this.scene.start('GameScene');
    }
}

// -------------------------------------------------------
// MAIN GAME SCENE
// -------------------------------------------------------
class GameScene extends Phaser.Scene {
    constructor() { super('GameScene'); }

    init() {
        // core game state
        this.gridState = Array(16).fill(null);
        this.queue = [];
        this.keepVal = null;

        this.score = 0;
        this.level = 1;
        this.trashUses = 2;

        this.bestScore = parseInt(localStorage.getItem('justDivideBest')) || 0;

        this.slots = [];
        this.gridSprites = [];
        this.queueSprites = [];

        // features
        this.undoStack = [];
        this.hintsOn = true;
        this.timerSec = 0;
        this.timerEvent = null;
        this.difficulty = 2; // 1-easy, 2-medium, 3-hard
        this.highlightGraphics = null;

        // top queue world sprite reference
        this.topQueueSprite = null;
    }

    create() {
        // Debug wrapper: surfaces errors to the screen if create() throws
        try {
            // Background
            const bg = this.add.image(CONFIG.width/2, CONFIG.height/2, 'bg_desktop');
            bg.setDisplaySize(CONFIG.width, CONFIG.height);

            this.createHeader();
            this.createRightPanel();
            this.createGrid();

            // Top drag layer so dragged tiles always render above UI
            this.dragLayer = this.add.layer();

            // graphics used for hints highlighting
            this.highlightGraphics = this.add.graphics();

            // Initialize gameplay
            this.fillQueue();
            this.renderQueue();
            this.renderKeep();
            this.renderGrid();
            this.updateUI();

            // Timer
            this.startTimer();

            // Drag handling: simplified because topQueueSprite is on dragLayer already
            this.input.on('dragstart', (pointer, tile) => {
                if (!tile.isQueueTile && !tile.isKeep) return;

                // bring to top and animate
                tile.setDepth(1000);
                this.children.bringToTop(tile);

                this.tweens.killTweensOf(tile);
                this.tweens.add({
                    targets: tile,
                    scale: 1.12,
                    duration: 120,
                    ease: 'Power2'
                });

                tile._isBeingDragged = true;
            });

            this.input.on('drag', (pointer, tile, x, y) => {
                tile.x = x;
                tile.y = y;
                this.renderHints();
            });

            this.input.on('dragend', (pointer, tile) => {
                tile._isBeingDragged = false;

                this.tweens.killTweensOf(tile);
                this.tweens.add({
                    targets: tile,
                    scale: 1.0,
                    duration: 120,
                    ease: 'Power2'
                });

                this.handleDrop(tile);
            });

            // keyboard controls
            this.input.keyboard.on('keydown-R', () => this.scene.restart());
            this.input.keyboard.on('keydown-Z', () => this.undo());
            this.input.keyboard.on('keydown-G', () => { this.hintsOn = !this.hintsOn; this.renderHints(); });
            this.input.keyboard.on('keydown-ONE', () => { this.setDifficulty(1); });
            this.input.keyboard.on('keydown-TWO', () => { this.setDifficulty(2); });
            this.input.keyboard.on('keydown-THREE', () => { this.setDifficulty(3); });

            // clicking keep slot to swap top queue tile with keep
            if (this.keepSlot) {
                this.keepSlot.setInteractive();
                this.keepSlot.on('pointerdown', () => {
                    const topVal = this.queue.length > 0 ? this.queue[0] : null;
                    if (topVal === null) return;
                    this.pushState();
                    this.swapTopWithKeepByClick();
                });
            }

            // initial hint render
            this.renderHints();

        } catch (err) {
            console.error('GameScene.create() error:', err);
            const msg = (err && err.stack) ? err.stack : String(err);
            this.add.text(40, 120, 'Error during scene create:\n\n' + msg, {
                fontFamily: 'monospace',
                fontSize: '14px',
                color: '#610000',
                backgroundColor: '#fff2f2',
                padding: { x: 12, y: 12 },
                fixedWidth: CONFIG.width - 80
            }).setOrigin(0, 0);
            this.scene.pause();
            return;
        }
    }

    // -------------------- UI LAYOUT --------------------
    createHeader() {
        const cx = CONFIG.width / 2 - 120;

        this.add.text(cx, 40, "JUST DIVIDE", {
            fontFamily: 'Arial',
            fontSize: '48px',
            color: CONFIG.colors.text,
            fontStyle: 'bold'
        }).setOrigin(0.5);

        this.add.text(cx, 85,
            "DIVIDE WITH THE NUMBERS TO SOLVE THE ROWS AND COLUMNS.",
            { fontFamily: 'Arial', fontSize: '20px', color: '#666', fontStyle: 'bold' }
        ).setOrigin(0.5);

        this.add.image(cx, 160, 'cat').setScale(0.85);

        const badgeY = 240;
        const dist = 190;

        // Level badge
        this.add.image(cx - dist/2, badgeY, 'badge').setScale(0.75);
        this.levelText = this.add.text(cx - dist/2, badgeY, "LEVEL 1", {
            fontFamily: 'Arial', fontSize: '24px', color: '#fff', fontStyle: 'bold'
        }).setOrigin(0.5);

        // Score badge
        this.add.image(cx + dist/2, badgeY, 'badge').setScale(0.75);
        this.scoreText = this.add.text(cx + dist/2, badgeY - 12, "SCORE 0", {
            fontFamily: 'Arial', fontSize: '22px', color: '#fff', fontStyle: 'bold'
        }).setOrigin(0.5);

        this.bestText = this.add.text(cx + dist/2, badgeY + 20, "BEST " + this.bestScore, {
            fontFamily: 'Arial', fontSize: '18px', color: '#fff'
        }).setOrigin(0.5);

        // Timer
        this.timerText = this.add.text(cx + dist/2 + 110, badgeY, "00:00", {
            fontFamily: 'Arial', fontSize: '20px', color: '#333'
        }).setOrigin(0.5);
    }

    createRightPanel() {
        const px = CONFIG.width - 280;
        const py = CONFIG.height / 2;
        const w = 220;
        const h = 780;

        const gfx = this.add.graphics();
        gfx.fillStyle(CONFIG.colors.panelBg, 1);
        gfx.lineStyle(4, CONFIG.colors.panelBorder, 1);
        gfx.fillRoundedRect(px - w/2, py - h/2, w, h, 30);
        gfx.strokeRoundedRect(px - w/2, py - h/2, w, h, 30);

        // KEEP
        const keepY = py - 220;
        this.add.text(px, keepY - 85, "KEEP", {
            fontFamily: 'Arial', fontSize: '28px', color: '#cc5500', fontStyle: 'bold'
        }).setOrigin(0.5);

        this.keepSlot = this.add.image(px, keepY, 'slot').setDisplaySize(130, 130);

        // QUEUE container
        this.queueContainer = this.add.container(px, py + 40);
        this.queueContainer.setSize(200, 300);

        // TRASH
        const trashY = py + 300;
        this.add.text(px, trashY - 70, "TRASH", {
            fontFamily: 'Arial', fontSize: '28px', color: '#cc5500', fontStyle: 'bold'
        }).setOrigin(0.5);

        this.trashIcon = this.add.image(px, trashY, 'trash').setDisplaySize(100, 100);
        this.trashText = this.add.text(px, trashY + 70, "x" + this.trashUses, {
            fontFamily: 'Arial', fontSize: '32px', color: '#fff', stroke: '#000', strokeThickness: 4, fontStyle: 'bold'
        }).setOrigin(0.5);
    }

    createGrid() {
        const startX = (CONFIG.width / 2 - 120)
            - ((4 * CONFIG.grid.cellSize + 3 * CONFIG.grid.gap) / 2)
            + CONFIG.grid.cellSize/2;

        const startY = 480;

        for (let i = 0; i < 16; i++) {
            const r = Math.floor(i / 4);
            const c = i % 4;

            const x = startX + c * (CONFIG.grid.cellSize + CONFIG.grid.gap);
            const y = startY + r * (CONFIG.grid.cellSize + CONFIG.grid.gap);

            const slot = { x, y, index: i };
            this.slots.push(slot);

            // visual slot background (rounded rect)
            const gfx = this.add.graphics();
            gfx.fillStyle(CONFIG.colors.slotBg, 1);
            gfx.lineStyle(4, CONFIG.colors.slotBorder, 1);
            const w = CONFIG.grid.cellSize;
            const h = CONFIG.grid.cellSize;
            gfx.fillRoundedRect(x - w/2, y - h/2, w, h, 12);
            gfx.strokeRoundedRect(x - w/2, y - h/2, w, h, 12);
        }
    }

    // -------------------- TILE CREATION --------------------
    getRandomTileValue() {
        const easy = [2,3,4,5,6,8,9,10];
        const medium = [2,3,4,5,6,8,9,10,12,15,16,20];
        const hard = [3,4,5,6,8,9,10,12,15,16,20,24,25,30,32];

        if (this.difficulty === 1) return Phaser.Math.RND.pick(easy);
        if (this.difficulty === 3) return Phaser.Math.RND.pick(hard);
        return Phaser.Math.RND.pick(medium);
    }

    getTileImageKey(val) {
        if (val <= 8) return 'tile_blue';
        if (val <= 15) return 'tile_orange';
        if (val <= 25) return 'tile_pink';
        return 'tile_purple';
    }

    createTile(x, y, val) {
        const container = this.add.container(x, y);
        container.value = val;

        const img = this.add.image(0, 0, this.getTileImageKey(val))
            .setDisplaySize(CONFIG.grid.cellSize, CONFIG.grid.cellSize);

        const txt = this.add.text(0, 0, String(val), {
            fontFamily: 'Arial', fontSize: '52px',
            color: '#fff', stroke: '#000', strokeThickness: 2,
            fontStyle: 'bold'
        }).setOrigin(0.5);

        container.add([img, txt]);
        container.setSize(CONFIG.grid.cellSize, CONFIG.grid.cellSize);

        return container;
    }

    // -------------------- QUEUE --------------------
    fillQueue() {
        while (this.queue.length < 3) {
            this.queue.push(this.getRandomTileValue());
        }
    }

    renderQueue() {
        // destroy previous sprites
        this.queueSprites.forEach(s => {
            try { s.destroy(); } catch (e) {}
        });
        this.queueSprites = [];

        // clear container visuals (previews)
        this.queueContainer.removeAll(true);

        // compute world position of queue container (it's placed at px,py when created)
        const worldX = this.queueContainer.x;
        const worldY = this.queueContainer.y;

        // create previews (non-draggable) in the container for items index 1..end
        for (let i = this.queue.length - 1; i >= 1; i--) {
            const val = this.queue[i];
            const preview = this.createTile(0, (i) * 15, val);
            preview.getAt(0).setTint(0xdddddd).setAlpha(0.9);
            preview.setScale(0.95);
            // add to queueContainer so its position is relative to container
            this.queueContainer.add(preview);
            this.queueSprites.push(preview);
        }

        // create top draggable tile separately as a child of dragLayer at world coords
        if (this.queue.length > 0) {
            const topVal = this.queue[0];

            // destroy any previous top sprite we might have created
            if (this.topQueueSprite) {
                try { this.topQueueSprite.destroy(); } catch (e) {}
                this.topQueueSprite = null;
            }

            // create tile at world coords (dragLayer)
            const topTile = this.createTile(worldX, worldY, topVal);
            topTile.isQueueTile = true;
            topTile.isPlayable = true;
            topTile.value = topVal;

            // make it draggable (world object)
            topTile.setInteractive({ draggable: true });

            // store reference
            this.topQueueSprite = topTile;
            this.queueSprites.unshift(topTile);

            // small entrance animation for polish
            this.tweens.killTweensOf(topTile);
            topTile.setScale(1.0);
            this.tweens.add({
                targets: topTile,
                scale: 1.05,
                duration: 200,
                yoyo: true,
                ease: 'Sine'
            });
        } else {
            // no items — ensure top sprite removed
            if (this.topQueueSprite) {
                try { this.topQueueSprite.destroy(); } catch (e) {}
                this.topQueueSprite = null;
            }
        }

        this.renderHints();
    }

    renderKeep() {
        if (this.keepItemSprite) this.keepItemSprite.destroy();
        this.keepItemSprite = null;

        if (this.keepVal !== null) {
            this.keepItemSprite = this.createTile(this.keepSlot.x, this.keepSlot.y, this.keepVal);
            this.keepItemSprite.isKeep = true;
            this.keepItemSprite.setInteractive({ draggable: true });
            this.keepItemSprite.originalX = this.keepSlot.x;
            this.keepItemSprite.originalY = this.keepSlot.y;
        }

        this.renderHints();
    }

    swapQueueAndKeep(queueTile) {
        this.pushState();

        const previousKeep = this.keepVal;

        this.keepVal = queueTile.value;
        this.queue.shift();

        if (previousKeep !== null) {
            this.queue.unshift(previousKeep);
        }

        this.fillQueue();

        // tile was the topQueueSprite or a keep-dragged sprite; destroy and re-render
        try { queueTile.destroy(); } catch (e) {}
        this.topQueueSprite = null;

        this.renderQueue();
        this.renderKeep();
        this.updateUI();
        this.checkGameOver();
    }

    swapTopWithKeepByClick() {
        if (this.queue.length === 0) return;
        const prevKeep = this.keepVal;
        const top = this.queue.shift();
        this.keepVal = top;
        if (prevKeep !== null) this.queue.unshift(prevKeep);
        this.fillQueue();
        this.renderQueue();
        this.renderKeep();
        this.updateUI();
    }

    // -------------------- DRAG / DROP --------------------
    handleDrop(tile) {
        const bounds = tile.getBounds();
        const center = { x: bounds.centerX, y: bounds.centerY };

        // TRASH
        if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, this.trashIcon.getBounds())) {
            if (tile.isQueueTile && this.trashUses > 0) {
                this.pushState();
                this.trashUses--;
                this.queue.shift();
                this.fillQueue();
                try { tile.destroy(); } catch (e) {}
                this.topQueueSprite = null;
                this.renderQueue();
                this.updateUI();
                return;
            }
            return this.resetTilePosition(tile);
        }

        // KEEP
        if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, this.keepSlot.getBounds())) {
            if (tile.isQueueTile) {
                this.swapQueueAndKeep(tile);
            } else if (tile.isKeep) {
                this.resetTilePosition(tile);
            }
            return;
        }

        // GRID
        let index = -1;
        for (let i = 0; i < 16; i++) {
            const slot = this.slots[i];
            const dist = Phaser.Math.Distance.Between(center.x, center.y, slot.x, slot.y);
            if (dist < CONFIG.grid.cellSize / 2) { index = i; break; }
        }

        if (index !== -1) {
            return this.attemptMerge(index, tile);
        }

        return this.resetTilePosition(tile);
    }

    resetTilePosition(tile) {
        if (tile.isQueueTile) {
            try { tile.destroy(); } catch (e) {}
            if (this.topQueueSprite === tile) this.topQueueSprite = null;
            this.renderQueue();
            return;
        }

        if (tile.isKeep) {
            try { tile.destroy(); } catch (e) {}
            this.renderKeep();
        }
    }

    // -------------------- MERGE / DIVIDE --------------------
    attemptMerge(index, tile) {
        if (!tile.isQueueTile && !tile.isKeep) {
            return this.resetTilePosition(tile);
        }

        const placed = tile.value;
        const current = this.gridState[index];

        // push state before modifying
        this.pushState();

        // EMPTY slot => place
        if (current === null) {
            this.gridState[index] = placed;
            return this.completeMove(tile, index);
        }

        // MATCH
        if (placed === current) {
            this.gridState[index] = null;
            this.score += placed * 2;
            this.showFloatingText(index, "MATCH!");
            return this.completeMove(tile, index);
        }

        // DIVISIBLE
        const larger = Math.max(placed, current);
        const smaller = Math.min(placed, current);

        if (larger % smaller === 0) {
            const result = larger / smaller;

            if (result === 1) {
                this.gridState[index] = null;
                this.showFloatingText(index, "CLEARED!");
            } else {
                this.gridState[index] = result;
                this.showFloatingText(index, "DIVIDE!");
            }

            this.score += larger;
            return this.completeMove(tile, index);
        }

        // invalid: nothing changed — remove the just-pushed snapshot
        if (this.undoStack.length > 0) this.undoStack.pop();
        this.resetTilePosition(tile);
    }

    // -------------------- COMPLETE MOVE (animated) --------------------
    completeMove(tile, targetIndex) {
        const wasQueue = tile.isQueueTile;
        const wasKeep = tile.isKeep;

        // find target position
        let targetX = null, targetY = null;
        if (typeof targetIndex !== 'undefined' && targetIndex !== null) {
            const slot = this.slots[targetIndex];
            targetX = slot.x;
            targetY = slot.y;
        }

        const finishPlacement = () => {
            try { tile.destroy(); } catch (e) {}

            if (wasQueue) {
                this.queue.shift();
                this.fillQueue();
                this.topQueueSprite = null;
                this.renderQueue();
            }

            if (wasKeep) {
                this.keepVal = null;
                this.renderKeep();
            }

            this.renderGrid();
            this.updateUI();
            this.checkLevelProgress();
            this.checkGameOver();
        };

        if (targetX !== null && targetY !== null) {
            // animate the dragged tile onto the grid cell
            this.tweens.add({
                targets: tile,
                x: targetX,
                y: targetY,
                scale: 1.0,
                duration: 260,
                ease: 'Back.easeOut',
                onComplete: () => {
                    // small landing flash
                    const flash = this.add.circle(targetX, targetY, CONFIG.grid.cellSize * 0.45, 0xffffff, 0.12);
                    this.tweens.add({
                        targets: flash,
                        alpha: 0,
                        scale: 0.5,
                        duration: 300,
                        onComplete: () => flash.destroy()
                    });
                    finishPlacement();
                }
            });
        } else {
            finishPlacement();
        }
    }

    renderGrid() {
        this.gridSprites.forEach(s => s.destroy());
        this.gridSprites = [];

        for (let i = 0; i < 16; i++) {
            const val = this.gridState[i];
            if (val !== null) {
                const slot = this.slots[i];
                const t = this.createTile(slot.x, slot.y, val);
                t.disableInteractive();
                this.gridSprites.push(t);
            }
        }

        // update hints after grid changes
        this.renderHints();
    }

    // -------------------- UNDO / STATE --------------------
    pushState() {
        const snapshot = {
            gridState: this.gridState.slice(),
            queue: this.queue.slice(),
            keepVal: this.keepVal,
            score: this.score,
            level: this.level,
            trashUses: this.trashUses,
            timerSec: this.timerSec
        };
        this.undoStack.push(snapshot);
        if (this.undoStack.length > CONFIG.MAX_UNDO) this.undoStack.shift();
    }

    undo() {
        if (this.undoStack.length === 0) return;
        const snap = this.undoStack.pop();

        this.gridState = snap.gridState.slice();
        this.queue = snap.queue.slice();
        this.keepVal = snap.keepVal;
        this.score = snap.score;
        this.level = snap.level;
        this.trashUses = snap.trashUses;
        this.timerSec = snap.timerSec;

        this.renderGrid();
        this.renderQueue();
        this.renderKeep();
        this.updateUI();
        this.renderHints();
    }

    // -------------------- UI / GAME STATE --------------------
    updateUI() {
        this.scoreText.setText("SCORE " + this.score);
        this.levelText.setText("LEVEL " + this.level);
        this.trashText.setText("x" + this.trashUses);
        this.bestText.setText("BEST " + this.bestScore);

        if (this.score > this.bestScore) {
            this.bestScore = this.score;
            localStorage.setItem('justDivideBest', this.bestScore);
            this.bestText.setText("BEST " + this.bestScore);
        }
    }

    checkLevelProgress() {
        const newLevel = Math.floor(this.score / 10) + 1;
        if (newLevel > this.level) {
            this.level = newLevel;
            this.trashUses++;
            this.tweens.add({
                targets: this.levelText,
                scale: 1.5,
                duration: 200,
                yoyo: true
            });
        }
    }

    checkGameOver() {
        if (this.gridState.includes(null)) return;

        const active = [];
        if (this.queue.length > 0) active.push(this.queue[0]);
        if (this.keepVal !== null) active.push(this.keepVal);

        if (active.length === 0) return this.showGameOver();

        const canMerge = (a, b) => {
            if (a === b) return true;
            const big = Math.max(a, b);
            const small = Math.min(a, b);
            return big % small === 0;
        };

        for (const g of this.gridState) {
            for (const a of active) {
                if (canMerge(a, g)) return;
            }
        }

        this.showGameOver();
    }

    showFloatingText(index, msg) {
        const slot = this.slots[index];
        const txt = this.add.text(slot.x, slot.y, msg, {
            fontFamily: 'Arial', fontSize: '32px',
            color: '#ffff00', stroke: '#000', strokeThickness: 4,
            fontStyle: 'bold'
        }).setOrigin(0.5);

        this.tweens.add({
            targets: txt,
            y: slot.y - 60,
            alpha: 0,
            duration: 1000,
            onComplete: () => txt.destroy()
        });
    }

    showGameOver() {
        this.scene.pause();

        const overlay = this.add.rectangle(CONFIG.width/2, CONFIG.height/2, CONFIG.width, CONFIG.height, 0x000000, 0.7);
        overlay.setInteractive();

        this.add.text(CONFIG.width/2, CONFIG.height/2 - 50, "GAME OVER", {
            fontFamily: 'Arial', fontSize: '64px', color: '#fff', fontStyle: 'bold'
        }).setOrigin(0.5);

        this.add.text(CONFIG.width/2, CONFIG.height/2 + 50,
            `Score: ${this.score} (Best: ${this.bestScore})`,
            { fontFamily: 'Arial', fontSize: '40px', color: '#fff' }
        ).setOrigin(0.5);

        this.add.text(CONFIG.width/2, CONFIG.height/2 + 150, "Press R to Restart", {
            fontFamily: 'Arial', fontSize: '32px', color: '#ffff00'
        }).setOrigin(0.5);
    }

    // -------------------- HINTS --------------------
    renderHints() {
        this.highlightGraphics.clear();

        if (!this.hintsOn) return;

        const activeVal = (this.queue.length > 0 ? this.queue[0] : (this.keepVal !== null ? this.keepVal : null));
        if (activeVal === null) return;

        const canMergeVals = (a, b) => {
            if (b === null) return false;
            if (a === b) return true;
            const big = Math.max(a, b);
            const small = Math.min(a, b);
            return big % small === 0;
        };

        for (let i = 0; i < 16; i++) {
            if (this.gridState[i] !== null) continue;
            const r = Math.floor(i / 4);
            const c = i % 4;

            const neighbors = [];
            if (r > 0) neighbors.push(this.gridState[(r-1)*4 + c]);
            if (r < 3) neighbors.push(this.gridState[(r+1)*4 + c]);
            if (c > 0) neighbors.push(this.gridState[r*4 + (c-1)]);
            if (c < 3) neighbors.push(this.gridState[r*4 + (c+1)]);

            const possible = neighbors.some(n => canMergeVals(activeVal, n));
            if (possible) {
                const slot = this.slots[i];
                const w = CONFIG.grid.cellSize;
                const h = CONFIG.grid.cellSize;
                this.highlightGraphics.lineStyle(4, 0xffff00, 1);
                this.highlightGraphics.strokeRoundedRect(slot.x - w/2, slot.y - h/2, w, h, 12);
            }
        }
    }

    // -------------------- TIMER --------------------
    startTimer() {
        if (this.timerEvent) this.timerEvent.remove();

        this.timerSec = 0;
        this.timerEvent = this.time.addEvent({
            delay: 1000,
            loop: true,
            callback: () => {
                this.timerSec++;
                const m = Math.floor(this.timerSec / 60).toString().padStart(2, '0');
                const s = (this.timerSec % 60).toString().padStart(2, '0');
                this.timerText.setText(`${m}:${s}`);
            }
        });
    }

    // -------------------- DIFFICULTY --------------------
    setDifficulty(n) {
        if (![1,2,3].includes(n)) return;
        this.difficulty = n;
        const info = this.add.text(CONFIG.width - 80, 60, `D ${n}`, { fontFamily: 'Arial', fontSize: '22px', color: '#000', backgroundColor: '#fff' })
            .setOrigin(0.5);
        this.tweens.add({ targets: info, alpha: 0, duration: 1300, delay: 700, onComplete: () => info.destroy() });

        this.queue = [];
        this.fillQueue();
        this.renderQueue();
    }
}

// -------------------------------------------------------
// PHASER CONFIG
// -------------------------------------------------------
const config = {
    type: Phaser.AUTO,
    width: CONFIG.width,
    height: CONFIG.height,
    backgroundColor: '#ffeef2',
    parent: 'game-container',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, GameScene]
};

const game = new Phaser.Game(config);