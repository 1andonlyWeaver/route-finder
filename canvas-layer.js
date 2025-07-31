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
        if (!this._container) {
            this._container = map.getPane(this.options.pane);
            this._renderer.getContainer().style.zIndex = 1; // Ensure it's behind markers but above tiles
            this._container.appendChild(this._renderer.getContainer());
        }
        
        this._renderer.on('update', this._update, this);
        map.on('moveend', this._reset, this);
        map.on('zoomend', this._reset, this);

        this.getEvents = function () {
            return {
                viewreset: this._reset,
                zoom: this._reset,
                moveend: this._reset,
                zoomend: this._reset
            };
        };

        this._renderer.addTo(map);
    },

    onRemove: function (map) {
        L.DomUtil.remove(this._renderer.getContainer());
        map.off('moveend', this._reset, this);
        map.off('zoomend', this._reset, this);
        this._renderer.off('update', this._update, this);
        this._renderer.remove();
    },

    _update: function () {
        if (this._map && this.options.render) {
            this.options.render.call(this, this._renderer.getContainer().getContext('2d'), {
                map: this._map,
                bounds: this._map.getBounds(),
                size: this._renderer._size,
                zoom: this._map.getZoom(),
                center:this._map.getCenter()
            });
        }
    },

    _reset: function () {
        if (this._renderer) {
            this._renderer._update();
        }
        this._update();
    }
});

L.canvasLayer = function (options) {
    return new L.CanvasLayer(options);
};
