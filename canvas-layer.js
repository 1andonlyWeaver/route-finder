L.CanvasLayer = L.Layer.extend({
    options: {
        padding: 0.1,
        pane: 'overlayPane'
    },

    initialize: function (options) {
        L.setOptions(this, options);
        L.stamp(this);
        this._renderer = L.canvas({ padding: this.options.padding });
    },

    onAdd: function (map) {
        this._map = map;
        this._renderer.addTo(map);

        // Add a class to the renderer's container for easy selection
        L.DomUtil.addClass(this._renderer._container, 'leaflet-custom-canvas-layer');

        this._renderer.on('update', this._update, this);
        map.on({
            'movestart': this._onMoveStart,
            'moveend': this._reset,
            'zoomstart': this._onMoveStart,
            'zoomend': this._reset,
            'resize': this._reset
        }, this);
    },

    onRemove: function (map) {
        map.off({
            'movestart': this._onMoveStart,
            'moveend': this._reset,
            'zoomstart': this._onMoveStart,
            'zoomend': this._reset,
            'resize': this._reset
        }, this);
        this._renderer.off('update', this._update, this);
        this._renderer.remove();
        this._renderer = null;
    },

    _onMoveStart: function () {
        // Clear canvas immediately when movement starts to prevent artifacts
        if (this._renderer && this._renderer._container) {
            const ctx = this._renderer._container.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            }
        }
    },

    _update: function () {
        if (this._renderer && this._map && this.options.render) {
            const ctx = this._renderer._container.getContext('2d');
            this.options.render.call(this, ctx, {
                map: this._map,
                bounds: this._map.getBounds(),
                size: this._map.getSize(),
                zoom: this._map.getZoom(),
                center: this._map.getCenter()
            });
        }
    },

    _reset: function () {
        // Clear the canvas completely when map moves/zooms
        if (this._renderer && this._renderer._container) {
            const ctx = this._renderer._container.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            }
        }
        
        if (this._renderer) {
            this._renderer._update();
        }
        this._update();
    }
});

L.canvasLayer = function (options) {
    return new L.CanvasLayer(options);
};
