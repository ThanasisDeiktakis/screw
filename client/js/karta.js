/*! KartaJS v0.1 | MIT License | github.com/All4DK/KartaJS */

/**
 * Simple event emitter class
 */
class EventEmitter {
    constructor() {
        this._events = new Map();
    }

    /**
     * Subscribe to an event
     */
    on(event, fn, options = {}) {
        if (!this._events.has(event)) {
            this._events.set(event, []);
        }

        const listener = {
            fn,
            once: !!options.once,
            context: options.context || this
        };

        this._events.get(event).push(listener);


        return () => this.off(event, fn);
    }

    /**
     * Subscribe to an event (once only)
     */
    once(event, fn) {
        return this.on(event, fn, { once: true });
    }

    /**
     * Unsubscribe from an event
     */
    off(event, fn) {
        if (!this._events.has(event)) return;

        if (!fn) {
            // Remove all handlers for the event / Delete
            this._events.delete(event);
            return;
        }

        const listeners = this._events.get(event);
        const filtered = listeners.filter(listener => listener.fn !== fn);

        if (filtered.length === 0) {
            this._events.delete(event);
        } else {
            this._events.set(event, filtered);
        }
    }

    /**
     * Emit an event
     */
    emit(event, data = {}) {
        if (!this._events.has(event)) return false;

        const listeners = this._events.get(event).slice(); // Copy the array
        let hasListeners = false;

        for (let i = 0; i < listeners.length; i++) {
            const listener = listeners[i];

            try {
                listener.fn.call(listener.context, {
                    type: event,
                    target: this,
                    data: data,
                    timestamp: Date.now()
                });
                hasListeners = true;
            } catch (err) {
                console.error(`Error in event handler for "${event}":`, err);
            }

            // Remove one-time handlers / Delete
            if (listener.once) {
                this.off(event, listener.fn);
            }
        }

        return hasListeners;
    }

    /**
     * Remove all subscriptions
     */
    removeAllListeners() {
        this._events.clear();
    }

    /**
     * Get the number of handlers for an event
     * @returns {number}
     */
    listenerCount(event) {
        if (!this._events.has(event)) return 0;
        return this._events.get(event).length;
    }
}

/**
 * Main KartaJS class
 */
class KartaJS extends EventEmitter {
    /**
     * Map event constants
     * @readonly
     * @enum {string}
     */
    static EVENTS = Object.freeze({
        /** All tiles loaded*/
        LOAD: 'load',
        /** Map click*/
        CLICK: 'click',
        /** Map double-click*/
        DBLCLICK: 'dblclick',
        /** Map is moving*/
        MOVE: 'move',
        /** Map move finished*/
        MOVEEND: 'moveend',
        /** Touch start*/
        TOUCHSTART: 'touchstart',
        /** Touch end*/
        TOUCHEND: 'touchend',
        /** Touch drag*/
        TOUCHMOVE: 'touchmove',
        /** Double tap*/
        DBLTAP: 'dbltap',
        /** Zoom start*/
        ZOOMSTART: 'zoomstart',
        /** Zoom finished*/
        ZOOMEND: 'zoomend',
        /** Key pressed*/
        KEYUP: 'keyup',
        /** Tile loaded*/
        TILELOAD: 'tileload',
        /** Tile load error*/
        TILEERROR: 'tileerror',
        /** Mouse button pressed*/
        MOUSEDOWN: 'mousedown',
        /** Mouse pointer moved*/
        MOUSEMOVE: 'mousemove',
        /** Mouse button released*/
        MOUSEUP: 'mouseup',
        /** Right-click*/
        CONTEXTMENU: 'contextmenu'
    });

    /**
     * Simple HTML sanitizer — strips dangerous tags and attributes.
     * @param {string} html
     * @returns {string}
     */
    static sanitizeHtml(html) {
        if (typeof html !== 'string') return '';
        const div = document.createElement('div');
        div.innerHTML = html;
        // Remove dangerous elements
        div.querySelectorAll('script,style,iframe,object,embed,form,input,textarea,select,button,link,meta,base,svg').forEach(el => el.remove());
        // Remove event-handler attributes and javascript: hrefs
        div.querySelectorAll('*').forEach(el => {
            for (const attr of [...el.attributes]) {
                const name = attr.name.toLowerCase();
                if (name.startsWith('on') || (name === 'href' && attr.value.trim().toLowerCase().startsWith('javascript:'))) {
                    el.removeAttribute(attr.name);
                }
            }
        });
        return div.innerHTML;
    }

    constructor(containerId, options = {}) {
        super();
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`KartaJS: container element with id "${containerId}" not found.`);
        }
        this.options = {
            center: options.center || [0, 0],
            zoom: options.zoom ?? 5,
            minZoom: options.minZoom ?? 1,
            maxZoom: options.maxZoom ?? 19,
            tileLayer: options.tileLayer || {
                url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                attribution: '© <a href="https://osm.org" target="_blank">OpenStreetMap</a>',
                subdomains: ['a', 'b', 'c']
            },
            showLatlngMonitor: (typeof options.showLatlngMonitor !== 'undefined') && options.showLatlngMonitor,
            interactive: (typeof options.interactive !== 'undefined') ? options.interactive : true,
            enableClusterManager: !!options.enableClusterManager,
            clusterManager: options.clusterManager || {},
        };

        this.tileSize = 256;
        this.isDragging = false;
        this.lastMousePos = {x: 0, y: 0, lat: 0, lng: 0};
        this.centerPoint = {x: 0, y: 0, lat: 0, lng: 0};
        this.currentOffset = {x: 0, y: 0};
        this.clearTimer = null;
        this.loadTimer = null;
        this.tiles = new Map();         // Tiles cache
        this.markers = new Map();       // Markers data
        this.overlayObjects = new Map(); // Overlay objects
        this.queuedTiles = 0;           // Tiles in queue or loading
        this.lastClickTime = 0;         // For double-click / double-tap
        this.clickCount = 1;            // For double-click / double-tap
        this.bounds = null;
        this.#init();
        this.setCenter(this.options.center);
        this.clusterManager = this.options.enableClusterManager ? new ClusterManager(this, this.options.clusterManager) : null;
        this.visibleMarkers = [];

        // Process markers array received during initialization
        if (options.markers && Array.isArray(options.markers)) {
            let autoCenter = {lat: 0, lng: 0};
            options.markers.forEach(markerOpts => {
                this.addMarker(markerOpts);
                autoCenter.lat += markerOpts.lat;
                autoCenter.lng += markerOpts.lng;
            });
            if (this.options.center[0] === 0 && this.options.center[1] === 0) {
                this.setCenter([autoCenter.lat/options.markers.length, autoCenter.lng/options.markers.length]);
            }
        }
    }

    #init() {
        this.#createContainer();

        if (this.options.interactive) {
            this.#setupEvents();
        }
    }

    #createContainer() {
        this.container.style.position = 'relative';
        this.container.style.overflow = 'hidden';
        this.container.style.cursor = 'default';
        this.container.style.touchAction = 'none';

        const controlsHtml = this.options.interactive
            ? '<div class="kjs-controls"><button class="kjs-zoom-in">▲</button><button class="kjs-zoom-out">▼</button></div>'
            : '';
        const latlngHtml = this.options.showLatlngMonitor
            ? '<div class="kjs-current-latlng">N:0.00 E:0.00</div>'
            : '';

        this.container.innerHTML = [
            '<div class="kjs-tiles-container"></div>',
            '<div class="kjs-markers-container"></div>',
            '<div class="kjs-overlay-container"></div>',
            '<div class="kjs-copyrights">' + this.options.tileLayer.attribution + ' | <a href="https://github.com/All4DK/KartaJS" target="_blank">KartaJS</a></div>',
            '<div class="kjs-popup-container"><div class="popup"></div></div>',
            controlsHtml,
            latlngHtml
        ].join('');

        this.tilesContainer = this.container.querySelector('.kjs-tiles-container');
        this.markersContainer = this.container.querySelector('.kjs-markers-container');
        this.overlayContainer = this.container.querySelector('.kjs-overlay-container');
        this.popupContainer = this.container.querySelector('.kjs-popup-container');
        this.popup = this.container.querySelector('.popup');
        this.currentLatlng = this.container.querySelector('.kjs-current-latlng');
        this.zoomInBtn = this.container.querySelector('.kjs-zoom-in');
        this.zoomOutBtn = this.container.querySelector('.kjs-zoom-out');
    }

    // ********* TILES ********* //
    /**
     * Loads new tiles that fall into the visible area
     */
    #loadTiles() {
        const rect = this.container.getBoundingClientRect();
        const containerWidth = rect.width;
        const containerHeight = rect.height;

        // Container not yet laid out — defer until next frame

        if (containerWidth === 0) {
            requestAnimationFrame(() => this.#loadTiles());
            return;
        }

        const centerTileX = Math.floor(this.centerPoint.x / this.tileSize);
        const centerTileY = Math.floor(this.centerPoint.y / this.tileSize);

        // Tiles count around the center point

        const tilesX = Math.ceil((containerWidth / this.tileSize) / 2) + 1;
        const tilesY = Math.ceil((containerHeight / this.tileSize) / 2) + 1;

        // Load tiles / Load
        for (let x = centerTileX - tilesX; x <= centerTileX + tilesX; x++) {
            for (let y = centerTileY - tilesY; y <= centerTileY + tilesY; y++) {
                this.#loadTile(x, y, this.getZoom());
            }
        }

        this.#updateObjectsPosition();
        this.#updateExistingTilesPosition();
        this.#clearOldTiles();
    }

    #loadTile(x, y, z) {
        const tileKey = `${z}/${x}/${y}`;

        if (this.tiles.has(tileKey)) {
            return;
        }

        const maxTileNum = Math.pow(2, z);
        const subdomain = this.options.tileLayer.subdomains ?
            this.options.tileLayer.subdomains[Math.abs(x + y) % this.options.tileLayer.subdomains.length] : 'a';

        const url = (x >= 0 && y >= 0 && x < maxTileNum && y < maxTileNum) ? this.options.tileLayer.url
            .replace('{s}', subdomain)
            .replace('{z}', z)
            .replace('{x}', x)
            .replace('{y}', y) : '';

        if (!url) {
            return;
        }

        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.style.cssText = `width: ${this.tileSize}px; height: ${this.tileSize}px;`;
        tile.style.backgroundColor = 'transparent';
        tile.setAttribute('zoom', z);


        tile.style.left = x * this.tileSize + 'px';
        tile.style.top = y * this.tileSize + 'px';

        // Load
        const img = new Image();
        img.src = url;
        this.queuedTiles++;
        img.onload = () => {
            tile.style.backgroundImage = `url(${url})`;
            tile.style.backgroundSize = 'cover';
            this.queuedTiles--;
            this.#clearOldTiles();
            this.emit(KartaJS.EVENTS.TILELOAD, {url: img.src});
        };
        img.onerror = () => {
            console.warn('Failed to load tile:', url);
            this.queuedTiles--;
            this.#clearOldTiles();
            tile.remove();
            this.tiles.delete(tileKey);
            this.emit(KartaJS.EVENTS.TILEERROR, {url: img.src});
        };
        this.tilesContainer.appendChild(tile);
        this.tiles.set(tileKey, tile);
    }

    #clearOldTiles() {
        clearTimeout(this.clearTimer);
        this.clearTimer = setTimeout(() => {
            this.tiles.forEach((tile, key, currentMap) => {
                const delta = Math.abs(parseInt(tile.getAttribute('zoom')) - this.getZoom());
                if (delta === 0) {
                    return;
                }
                if (delta === 1 && this.queuedTiles > 0) {
                    return;
                }

                tile.remove();
                currentMap.delete(key);
            });
            if (this.queuedTiles === 0) {
                this.emit(KartaJS.EVENTS.LOAD, {center: this.centerPoint});
            }
        }, 300);
    }

    /**
     * Move the map by a given pixel delta
     * @param deltaX int pixels
     * @param deltaY int pixels
     */
    panBy(deltaX = 0, deltaY = 0) {
        this.currentOffset.x += deltaX;
        this.currentOffset.y += deltaY;

        this.#updateExistingTilesPosition()

        // Update map center and markers / Update
        this.#updateCenterFromOffset();
        this.#updateObjectsPosition();
        this.bounds = null;

        this.emit(KartaJS.EVENTS.MOVE, {center: this.centerPoint});
    }

    /**
     * Update position for all tiles
     */
    #updateExistingTilesPosition() {
        this.tiles.forEach((tile, key) => {
            const [z, x, y] = key.split('/').map(Number);
            const zoomDelta = this.getZoom() - z;
            const multiplier = Math.pow(2, zoomDelta);
            const offsetX = x * this.tileSize * multiplier + this.currentOffset.x;
            const offsetY = y * this.tileSize * multiplier + this.currentOffset.y;
            tile.style.left = offsetX + 'px';
            tile.style.top = offsetY + 'px';
            tile.style.width = (this.tileSize * multiplier) + 'px';
            tile.style.height = (this.tileSize * multiplier) + 'px';
        });
    }
    // ********* /TILES ********* //

    // ********* EVENTS ********* //
    #setupEvents() {
        // Bind handlers once so they can be removed later in destroy()
        // Savedestroy()
        this._boundOnMouseMove = this.#onMouseMove.bind(this);
        this._boundOnMouseUp = this.#onMouseUp.bind(this);
        this._boundOnKeyUp = (e) => {
            switch (e.key) {
                case 'Escape': this.hidePopup(); break;
                case '+': this.zoomIn(); break;
                case '-': this.zoomOut(); break;
            }
            this.emit(KartaJS.EVENTS.KEYUP, {key: e.key});
        };

        this.container.addEventListener('mousedown', this.#onMouseDown.bind(this));
        document.addEventListener('mousemove', this._boundOnMouseMove);
        document.addEventListener('mouseup', this._boundOnMouseUp);
        this.container.addEventListener('contextmenu', this.#onContextMenu.bind(this));
        this.container.addEventListener('wheel', this.#onWheel.bind(this), {passive: false});
        this.zoomInBtn.addEventListener('click', () => this.zoomIn());
        this.zoomInBtn.addEventListener('touchend', () => this.zoomIn());
        this.zoomOutBtn.addEventListener('click', () => this.zoomOut());
        this.zoomOutBtn.addEventListener('touchend', () => this.zoomOut());
        this.container.addEventListener('touchstart', this.#onTouchStart.bind(this));
        this.container.addEventListener('touchmove', this.#onTouchMove.bind(this));
        this.container.addEventListener('touchend', this.#onTouchEnd.bind(this));

        this.popupContainer.addEventListener('click', (e) => {
            if (e.target === this.popupContainer) {
                this.hidePopup();
            }
        });
        this.popupContainer.addEventListener('touchstart', (e) => {
            if (e.target === this.popupContainer) {
                this.hidePopup();
            }
        });


        document.addEventListener('keyup', this._boundOnKeyUp);


        this._boundOnResize = () => {
            this.bounds = null;
            this.#loadTiles();
        };
        window.addEventListener('resize', this._boundOnResize);
    }

    #onMouseDown(e) {
        e.preventDefault();
        this.isDragging = true;
        this.hasDragged = false;
        this.mouseDownInside = true;
        this.container.style.cursor = 'grabbing';

        const now = Date.now();
        this.clickCount = (now - this.lastClickTime > 300) ? 1 : (this.clickCount + 1);
        this.lastClickTime = now;

        const coords = this.#pointToCoords(e.clientX, e.clientY);
        this.emit(KartaJS.EVENTS.MOUSEDOWN, {
            center: this.centerPoint,
            latlng: [coords.lat, coords.lng],
            pixel: {x: coords.x, y: coords.y},
            originalEvent: e
        });
    }

    #onMouseMove(e) {
        const coords = this.#pointToCoords(e.clientX, e.clientY);
        this.#setMousePos(coords);
        this.#updateLatlngMonitor(coords);

        if (this.isDragging) {
            this.hasDragged = true;
            this.panBy(coords.deltaX, coords.deltaY);
        }

        this.emit(KartaJS.EVENTS.MOUSEMOVE, {
            center: this.centerPoint,
            latlng: [coords.lat, coords.lng],
            pixel: {x: coords.x, y: coords.y},
            originalEvent: e
        });
    }

    #onMouseUp(e) {
        if (!this.mouseDownInside) return;
        this.mouseDownInside = false;

        const wasDragged = this.hasDragged;
        if (this.isDragging) {
            this.isDragging = false;
            this.hasDragged = false;
            if (wasDragged) {
                this.emit(KartaJS.EVENTS.MOVEEND, {center: this.centerPoint});
            }
        }
        this.container.style.cursor = 'default';

        const coords = this.#pointToCoords(e.clientX, e.clientY);

        if (this.clickCount === 2) {
            this.clickCount = 0;
            this.zoomIn(true);
            this.emit(KartaJS.EVENTS.DBLCLICK, {
                center: this.centerPoint,
                latlng: [coords.lat, coords.lng],
                pixel: {x: coords.x, y: coords.y},
                originalEvent: e
            });
            return;
        }

        this.emit(KartaJS.EVENTS.MOUSEUP, {
            center: this.centerPoint,
            latlng: [coords.lat, coords.lng],
            pixel: {x: coords.x, y: coords.y},
            originalEvent: e
        });

        // Emit CLICK only if the mouse didn't actually drag the map
        // GenerateCLICK
        if (!wasDragged) {
            this.emit(KartaJS.EVENTS.CLICK, {
                center: this.centerPoint,
                latlng: [coords.lat, coords.lng],
                pixel: {x: coords.x, y: coords.y},
                originalEvent: e
            });
        }

        this.#loadTiles();
    }

    #onContextMenu(e) {
        e.preventDefault(); // Prevent default browser context menu

        const coords = this.#pointToCoords(e.clientX, e.clientY);
        this.emit(KartaJS.EVENTS.CONTEXTMENU, {
            center: this.centerPoint,
            latlng: [coords.lat, coords.lng],
            pixel: {x: coords.x, y: coords.y},
            originalEvent: e
        });
    }

    #onWheel(e) {
        e.preventDefault();
        const zoomDelta = e.deltaY > 0 ? -1 : 1;
        this.setZoom(this.getZoom() + zoomDelta, true);
    }

    #onTouchStart(e) {
        e.preventDefault();

        let coords = this.#pointToCoords(e.touches[0].clientX, e.touches[0].clientY);
        if (e.touches.length === 1) {
            const now = Date.now();
            this.clickCount = (now - this.lastClickTime > 300) ? 1 : (this.clickCount + 1);
            this.lastClickTime = now;
        }

        if (e.touches.length === 2) {
            this.isZooming = true;
            coords = this.#pointToCoords(
                (e.touches[0].clientX + e.touches[1].clientX) / 2,
                (e.touches[0].clientY + e.touches[1].clientY) / 2
            );
            this.startTouchDistance = this.#getTouchDistance(e.touches);
            this.lastTouchDistance = this.#getTouchDistance(e.touches);
        }

        this.#setMousePos(coords);
        this.#updateLatlngMonitor(coords);

        this.emit(KartaJS.EVENTS.TOUCHSTART, {
            center: this.centerPoint,
            isDragging: this.isDragging,
            isZooming: this.isZooming,
            latlng: [coords.lat, coords.lng],
            pixel: {x: coords.x, y: coords.y},
            originalEvent: e
        });
    }

    #onTouchMove(e) {
        e.preventDefault();

        let coords = this.#pointToCoords(e.touches[0].clientX, e.touches[0].clientY);
        if (e.touches.length === 2) {
            coords = this.#pointToCoords((e.touches[0].clientX + e.touches[1].clientX) / 2,
                (e.touches[0].clientY + e.touches[1].clientY) / 2);
        }

        if (e.touches.length === 1) {
            this.isDragging = true;
            this.#setMousePos(coords);
            this.panBy(coords.deltaX, coords.deltaY);
        }

        if (this.isZooming && e.touches.length === 2) {
            this.lastTouchDistance = this.#getTouchDistance(e.touches);
            const zoomDelta = (this.startTouchDistance / this.lastTouchDistance);
            if (zoomDelta < 0.8) {
                this.zoomIn(true);
                this.startTouchDistance = this.lastTouchDistance
            } else if (zoomDelta > 1.2) {
                this.zoomOut(true);
                this.startTouchDistance = this.lastTouchDistance
            } else {
                this.#setMousePos(coords);
                this.panBy(coords.deltaX, coords.deltaY);
            }
        }

        this.emit(KartaJS.EVENTS.TOUCHMOVE, {
            center: this.centerPoint,
            latlng: [coords.lat, coords.lng],
            pixel: {x: coords.x, y: coords.y},
            originalEvent: e
        });
    }

    #onTouchEnd(e) {
        let coords = this.lastMousePos;
        if (e.changedTouches && e.changedTouches.length > 0) {
            coords = this.#pointToCoords(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
        }

        const wasDragging = this.isDragging;

        if (this.isDragging) {
            this.isDragging = false;
            this.emit(KartaJS.EVENTS.MOVEEND, {center: this.centerPoint});
            this.emit(KartaJS.EVENTS.TOUCHEND, {
                center: this.centerPoint,
                latlng: [coords.lat, coords.lng],
                pixel: {x: coords.x, y: coords.y},
                originalEvent: e
            });
        }

        if (this.clickCount === 2) {
            this.clickCount = 0;
            this.zoomIn(true);
            this.emit(KartaJS.EVENTS.DBLTAP, {
                center: this.centerPoint,
                latlng: [coords.lat, coords.lng],
                pixel: {x: coords.x, y: coords.y},
                originalEvent: e
            });
            this.isZooming = false;
            this.#loadTiles();
            return;
        }

        // Emit CLICK only if the touch didn't actually drag the map
        // GenerateCLICK
        if (!wasDragging && !this.isZooming) {
            this.emit(KartaJS.EVENTS.CLICK, {
                center: this.centerPoint,
                latlng: [coords.lat, coords.lng],
                pixel: {x: coords.x, y: coords.y},
                originalEvent: e
            });
        }

        this.isZooming = false;

        this.#loadTiles();
    }
    // ********* /EVENTS ********* //

    #updateLatlngMonitor(coords) {
        if (!this.options.showLatlngMonitor) {
            return;
        }

        this.currentLatlng.innerHTML =
            (coords.lat >= 0 ? 'N:' : 'S:')
            + Math.abs(coords.lat).toFixed(4)
            + ' '
            + (coords.lng >= 0 ? 'E:' : 'W:')
            + Math.abs(coords.lng).toFixed(4);
    }

    /**
     * Updates current map center coordinates
     */
    #updateCenterFromOffset() {
        const rect = this.container.getBoundingClientRect();
        const centerPixelX = -this.currentOffset.x + rect.width / 2;
        const centerPixelY = -this.currentOffset.y + rect.height / 2;
        this.centerPoint = this.pointToLatLng(centerPixelX, centerPixelY);


        const MAX_LAT = 85.05;
        if (this.centerPoint.lat > MAX_LAT || this.centerPoint.lat < -MAX_LAT) {
            this.centerPoint.lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, this.centerPoint.lat));
            this.#calcOffset([this.centerPoint.lat, this.centerPoint.lng]);
        }
    }

    setZoom(newZoom, byMouse = false) {
        if (newZoom < this.options.minZoom || newZoom > this.options.maxZoom) {
            return;
        }

        this.options.zoom = newZoom;

        // Update zoom-buttons state (enabled/disabled)
        if (this.options.interactive) {
            this.zoomInBtn.disabled = newZoom >= this.options.maxZoom;
            this.zoomOutBtn.disabled = newZoom <= this.options.minZoom;
        }

        if (byMouse) {
            this.#applyCenter([this.lastMousePos.lat, this.lastMousePos.lng]);
        } else {
            this.#applyCenter(this.getCenter());
        }

        this.bounds = null;
        this.emit(KartaJS.EVENTS.ZOOMSTART, {center: this.centerPoint});

        // Update geo-based objects on all layers
        this.#updateObjectsPosition();

        // Resize existing tiles before loading new ones
        this.#updateExistingTilesPosition();

        // setTimeout is used to skip unnecessary levels when zooming quickly
        clearTimeout(this.loadTimer);
        this.loadTimer = setTimeout(() => {
            this.#loadTiles();
            this.emit(KartaJS.EVENTS.ZOOMEND, {center: this.centerPoint});
        }, 500);
    }

    getZoom() {
        return this.options.zoom;
    }

    zoomIn(byMouse = false) {
        this.setZoom(this.getZoom() + 1, byMouse);
    }

    zoomOut(byMouse = false) {
        this.setZoom(this.getZoom() - 1, byMouse);
    }

    // Update position for all geo-based objects on all layers
    #updateObjectsPosition() {
        if (this.updatingGeoObjects) {
            return;
        }
        this.updatingGeoObjects = true;

        requestAnimationFrame(() => {
            // If the container hasn't been laid out yet, retry on next frame
            if (this.container.getBoundingClientRect().width === 0) {
                this.updatingGeoObjects = false;
                this.#updateObjectsPosition();
                return;
            }

            this.visibleMarkers = [];
            this.markers.forEach((marker) => {
                if (this.#isObjectInBounds(marker)) {
                    this.visibleMarkers.push(marker);
                    this.options.enableClusterManager || marker._showOnMap(); // Don't show marker when cluster-manager is enabled / Не показываем маркер если включён менеджер кластеров
                    this._calcObjectPosition(marker);
                } else {
                    marker._hideOnMap();
                }
            });
            this.options.enableClusterManager && this.clusterManager && this.clusterManager.processMarkers();
            this.updatingGeoObjects = false;
        });
    }

    _calcObjectPosition(object) {
        if (!object.element) {
            return;
        }

        if (!(object.cachePosition && object.cachePosition.zoom === this.getZoom())) {
            object.cachePosition = this.latLngToPoint(object.getLat(), object.getLng(), this.getZoom());
            object.cachePosition.zoom = this.getZoom();
        }

        const rect = this.container.getBoundingClientRect();
        const offsetX = object.cachePosition.x - this.centerPoint.x + (rect.width / 2);
        const offsetY = object.cachePosition.y - this.centerPoint.y + (rect.height / 2);

        object._setLeft(offsetX);
        object._setTop(offsetY);
    }

    isLatlngInBounds(lat, lng) {
        const bounds = this.getBounds();
        return lat >= bounds.south &&
            lat <= bounds.north &&
            lng >= bounds.west &&
            lng <= bounds.east;
    }

    #isObjectInBounds(object) {
        return this.isLatlngInBounds(object.lat, object.lng)
    }

    setCenter(latlng = [0, 0]) {
        // Defer until the container has been laid out by the browser

        if (this.container.getBoundingClientRect().width === 0) {
            requestAnimationFrame(() => this.setCenter(latlng));
            return;
        }
        this.#applyCenter(latlng);
        this.bounds = null;
        this.#loadTiles();
    }

    /**
     * Internal method: updates centerPoint and offset without calling loadTiles.
     * Used in setZoom and flyTo to avoid double loadTiles.
     */
    #applyCenter(latlng = [0, 0]) {
        this.centerPoint = this.latLngToPoint(...latlng);
        this.#calcOffset(latlng);
    }

    getCenter() {
        return [this.centerPoint.lat, this.centerPoint.lng];
    }

    /**
     * Atomically moves the map to the given coordinates and zoom level.
     * Unlike calling setCenter + setZoom separately, triggers only one loadTiles.
     * @param {Array} latlng - [lat, lng]
     * @param {number} zoom
     */
    flyTo(latlng, zoom) {
        const newZoom = Math.max(this.options.minZoom, Math.min(this.options.maxZoom, zoom));
        this.options.zoom = newZoom;

        if (this.options.interactive) {
            this.zoomInBtn.disabled = newZoom >= this.options.maxZoom;
            this.zoomOutBtn.disabled = newZoom <= this.options.minZoom;
        }

        this.#applyCenter(latlng);
        this.bounds = null;

        this.#updateObjectsPosition();
        this.#updateExistingTilesPosition();

        clearTimeout(this.loadTimer);
        this.loadTimer = setTimeout(() => {
            this.#loadTiles();
            this.emit(KartaJS.EVENTS.ZOOMEND, {center: this.centerPoint});
        }, 500);

        this.emit(KartaJS.EVENTS.ZOOMSTART, {center: this.centerPoint});
        this.emit(KartaJS.EVENTS.MOVE, {center: this.centerPoint});
    }

    #calcOffset(latlng = [0, 0]) {
        const rect = this.container.getBoundingClientRect();
        const pnt = this.latLngToPoint(...latlng);
        this.currentOffset = {x: Math.floor(rect.width / 2) - pnt.x, y: Math.floor(rect.height / 2) - pnt.y}
    }

    #degreesToRadians(deg) {
        return deg * (Math.PI / 180);
    }

    #radiansToDegrees(rad) {
        return rad * (180 / Math.PI);
    }

    /**
     * Converts geographic coordinates (latitude and longitude) to pixel coordinates at a given zoom level.
     * @param lat
     * @param lng
     * @param zoom
     * @returns {{x: number, y: number, lat, lng}}
     */
    latLngToPoint(lat, lng, zoom = -1) {
        if (zoom === -1) {
            zoom = this.getZoom();
        }

        const scale = 256 * Math.pow(2, zoom);
        const latRad = this.#degreesToRadians(lat);
        const x = (lng + 180) * (scale / 360);
        const mercator = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
        const y = (scale / 2) - (scale * mercator / (2 * Math.PI));

        return {x, y, lat, lng};
    }

    /**
     * Converts pixel coordinates to geographic coordinates (latitude and longitude) at a given zoom level.
     * @param x
     * @param y
     * @param zoom
     * @returns {{x, y, lat: *, lng: number}}
     */
    pointToLatLng(x, y, zoom = -1) {
        if (zoom === -1) {
            zoom = this.getZoom();
        }

        const scale = 256 * Math.pow(2, zoom);
        const lng = (x / scale) * 360 - 180;
        const mercator = (scale / 2 - y) * (2 * Math.PI) / scale;
        const latRad = 2 * Math.atan(Math.exp(mercator)) - Math.PI / 2;
        const lat = this.#radiansToDegrees(latRad);

        return {x, y, lat, lng};
    }

    /**
     * Calculates pixel and geographic coordinates for a screen point
     * @param x
     * @param y
     */
    #pointToCoords(x, y) {
        const rect = this.container.getBoundingClientRect();

        const clientX = x - rect.left;
        const clientY = y - rect.top;

        const coords = this.pointToLatLng(
            clientX - this.currentOffset.x,
            clientY - this.currentOffset.y
        );

        return {
            x: clientX,
            y: clientY,
            lat: coords.lat,
            lng: coords.lng,
            deltaX: clientX - this.lastMousePos.x,
            deltaY: clientY - this.lastMousePos.y
        }
    }

    /**
     * Stores provided coordinates (x,y,lat,lng) as the last known mouse position
     * @param coords
     */
    #setMousePos(coords) {
        this.lastMousePos.x = coords.x;
        this.lastMousePos.y = coords.y;
        this.lastMousePos.lat = coords.lat;
        this.lastMousePos.lng = coords.lng;
    }

    showPopup(content) {
        this.popup.innerHTML = KartaJS.sanitizeHtml(content);
        this.popupContainer.style.display = 'grid';
    }

    hidePopup() {
        this.popupContainer.style.display = 'none';
        this.popup.innerHTML = '';
    }

    #getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Returns the bounding box of the visible map area
     */
    getBounds() {
        if (this.bounds) {
            return this.bounds;
        }

        const rect = this.container.getBoundingClientRect();
        const containerWidth = rect.width;
        const containerHeight = rect.height;

        // If the container hasn't been laid out yet — return world bounds so
        // all markers pass isObjectInBounds() and are not incorrectly hidden.
        // The result is NOT cached so it gets recalculated once the layout is ready.
        if (containerWidth === 0) {
            return {north: 90, south: -90, east: 180, west: -180};
        }

        const northWest = this.pointToLatLng(-this.currentOffset['x'], -this.currentOffset['y']);

        const southEast = this.pointToLatLng(containerWidth - this.currentOffset['x'], containerHeight - this.currentOffset['y']);

        this.bounds = {
            north: Math.min(northWest.lat, 90),
            south: Math.max(southEast.lat, -90),
            east: Math.min(southEast.lng, 180),
            west: Math.max(northWest.lng, -180),
        };

        return this.bounds;
    }


    addMarker(options) {
        const marker = new Marker(this, options);
        this.markers.set(marker.getId(), marker);
        this.#updateObjectsPosition();
        return marker.getId();
    }

    getMarker(id) {
        return this.markers.get(id);
    }

    removeMarker(id) {
        const marker = this.markers.get(id);
        if (!marker) return null;
        marker.remove();
        this.markers.delete(id);

        return id;
    }

    clearMarkers() {
        this.markers.forEach(marker => marker.remove());
        this.markers.clear();
    }

    /**
     * Full map cleanup: removes event listeners, clears timers and DOM.
     * Must be called in SPAs before removing the container from the DOM.
     */
    destroy() {
        clearTimeout(this.clearTimer);
        clearTimeout(this.loadTimer);

        // Remove document-level handlers (not removed with the container)
        if (this.options.interactive) {
            document.removeEventListener('mousemove', this._boundOnMouseMove);
            document.removeEventListener('mouseup', this._boundOnMouseUp);
            document.removeEventListener('keyup', this._boundOnKeyUp);
            window.removeEventListener('resize', this._boundOnResize);
        }

        // Remove all markers / Delete
        this.clearMarkers();

        // Remove clusters / Delete
        if (this.clusterManager) {
            this.clusterManager.clearClusters();
        }

        this.tiles.forEach(tile => tile.remove());
        this.tiles.clear();
        this.overlayObjects.clear();
        this.container.innerHTML = '';
        this.removeAllListeners();
        this.tilesContainer = null;
        this.markersContainer = null;
        this.overlayContainer = null;
        this.popupContainer = null;
        this.popup = null;
        this.clusterManager = null;
    }

}

/**
 * Base class for map objects like markers, clusters and overlays.
 */
class MapObject extends EventEmitter {
    constructor(map) {
        super();
        this.element = {};
        this.map = map;
    }

    getLat() {
        return this.lat;
    }

    getLng() {
        return this.lng;
    }

    _getTop() {
        return parseInt(this.element.style.top);
    }

    _setTop(value) {
        if (!this.element.style) {
            return;
        }
        return this.element.style.top = value + 'px';
    }

    _getLeft() {
        return parseInt(this.element.style.left);
    }

    _setLeft(value) {
        if (!this.element.style) {
            return;
        }
        return this.element.style.left = value + 'px';
    }

    updatePosition() {
        return this.map._calcObjectPosition(this);
    }

    _hideOnMap() {
        if (!this.element.style) {
            return;
        }
        this.element.style.display = 'none';
    }

    _showOnMap() {
        if (!(this.element instanceof HTMLElement)) {
            return;
        }
        this.element.style.display = 'block';
    }

    _generateId(prefix) {
        const timestamp = Date.now().toString(36).slice(4);
        const random = Math.random().toString(36).substring(2,6);
        return `${prefix}_${timestamp}_${random}`;
    }
}

/**
 * Marker class representing a single marker on the map.
 */
class Marker extends MapObject {
    constructor(map, options) {
        super(map);
        this.id = options.id || this._generateId('id');
        this.lat = options.lat;
        this.lng = options.lng;
        this.title = options.title || '';
        this.color = options.color || '#38F';
        this.popup = options.popup || '';
        this.ico = options.ico || null;
        this.cssClass = options.cssClass || 'simple';
        this.cachePosition = null;
        this._showPopupOnInit = !!options.showPopup;

        // Element will be created lazily in _showOnMap() when the map is ready
    }

    #createElement() {
        this.element = document.createElement('div');
        if (this.ico) {
            const safeIco = this.ico.replace(/["\\()]/g, '');
            this.element.style.backgroundImage = `url("${safeIco}")`;
        } else {
            this.element.style.background = `${this.color}`;
        }

        this.element.className = 'marker ' + this.cssClass;

        if (this.title) {
            this.element.title = this.title;
        }

        this.map.markersContainer.appendChild(this.element);

        if (this.popup) {
            this.element.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showPopup();
            });
            this.element.addEventListener('touchend', (e) => {
                e.stopPropagation();
                this.showPopup();
            });
            this.element.addEventListener('wheel', (e) => {
                e.stopPropagation();
            }, {passive: true});
        }
    }

    getId() {
        return this.id;
    }

    _showOnMap() {
        if (!(this.element instanceof HTMLElement)) {
            this.#createElement();
            this.updatePosition();
            if (this._showPopupOnInit) {
                this._showPopupOnInit = false;
                this.showPopup();
            }
        }

        this.element.style.display = 'block';
    }

    showPopup() {
        if (!this.popup) {
            return;
        }

        if (this.isPopupOpen) {
            this.element.innerHTML = '';
            this.element.style.zIndex = 0;
            this.isPopupOpen = false;
        } else {
            this.element.innerHTML = '<div class="popup" style="border-color: ' + this.color + '">' + KartaJS.sanitizeHtml(this.popup) + '</div>';
            this.element.style.zIndex = 1;
            this.isPopupOpen = true;
        }
    }

    remove() {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
}

/**
 * Simple marker clustering
 * TODO: refactor to use events so the map doesn't know about clustering,
 * and cluster markers can be added via map's addObject method.
 */
class Cluster extends MapObject {
    constructor(map, cellData) {
        super(map);

        this.element = document.createElement('div');
        this.element.className = 'kjs-cluster';
        const count = (cellData.count > 10000) ? Math.floor(cellData.count / 1000) + 'k' : cellData.count;
        this.element.innerHTML = `<div class="kjs-cluster-text">${count}</div>`;

        this.element.addEventListener('click', (e) => {
            if (!this.map.isDragging && !this.map.isZooming) {
                e.stopPropagation();
                this.#zoomOnClick(cellData);
            }
        });

        this.element.addEventListener('touchend', (e) => {
            if (!this.map.isDragging && !this.map.isZooming) {
                e.stopPropagation();
                this.#zoomOnClick(cellData);
            }
        });

        this.map.overlayContainer.appendChild(this.element);
    }

    #zoomOnClick(cellData) {
        const centerLat = cellData.sumLat / cellData.count;
        const centerLng = cellData.sumLng / cellData.count;
        this.map.flyTo([centerLat, centerLng], this.map.getZoom() + 2);
    }
}

/**
 * ClusterManager class responsible for creating and managing clusters of markers.
 */
class ClusterManager {
    constructor(map, options = {}) {
        this.map = map;
        this.options = {
            maxZoom: options.maxZoom || 15,
            gridSize: options.gridSize || 75, // Cell size in pixels at zoom level
        };

        this.clusters = new Map(); // Map<clusterKey, clusterData>
    }

    processMarkers() {
        return this.#recalculateClusters(this.map.visibleMarkers, this.map.getZoom());
    }

    #recalculateClusters(markers, zoom) {
        this.clearClusters(); // Clears clusters and calls clusters.clear() internally 

        if (zoom >= this.options.maxZoom) {
            return this.#showAllMarkers(markers);
        }

        // Create new grid for this zoom level
        const grid = new Map();

        markers.forEach(marker => {
            const point = this.map.latLngToPoint(marker.getLat(), marker.getLng(), zoom);

            // Determine grid cell
            const cellX = Math.floor(point.x / this.options.gridSize);
            const cellY = Math.floor(point.y / this.options.gridSize);
            const cellKey = `${cellX}:${cellY}`;

            if (!grid.has(cellKey)) {
                grid.set(cellKey, {
                    sumLat: marker.getLat(),
                    sumLng: marker.getLng(),
                    count: 1,
                    markers: [marker],
                    cellX,
                    cellY,
                    key: cellKey
                });
            } else {
                const cell = grid.get(cellKey);
                cell.sumLat += marker.getLat();
                cell.sumLng += marker.getLng();
                cell.count++;
                cell.markers.push(marker);
            }
        });

        // Create clusters from non-empty cells
        for (const [cellKey, cellData] of grid.entries()) {
            if (cellData.count === 0) {
                continue;
            }

            if (cellData.count === 1) {
                this.#showAllMarkers(cellData.markers);
                continue;
            }

            this.#hideAllMarkers(cellData.markers);

            const cluster = new Cluster(this.map, cellData);
            cluster.lat = cellData.sumLat / cellData.count;
            cluster.lng = cellData.sumLng / cellData.count;
            this.clusters.set(cellKey, cluster);
        }

        this.#renderClusters();
    }

    /**
     * Calculate and apply cluster positions
     */
    #renderClusters() {
        for (const cluster of this.clusters.values()) {
            this.map._calcObjectPosition(cluster);
        }
    }

    #showAllMarkers(markers) {
        markers.forEach(marker => marker._showOnMap());
    }

    #hideAllMarkers(markers) {
        markers.forEach(marker => marker._hideOnMap());
    }

    /**
     * Remove all clusters from the map
     */
    clearClusters() {
        for (const cluster of this.clusters.values()) {
            if (cluster.element && cluster.element.parentNode) {
                cluster.element.parentNode.removeChild(cluster.element);
            }
        }
        this.clusters.clear();
    }
}

// Export for ESM / CommonJS; classes are also available as globals via <script>
// ExportESM / CommonJS; <script>
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KartaJS, Marker, ClusterManager };
}
