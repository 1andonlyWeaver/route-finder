document.addEventListener('DOMContentLoaded', () => {
    // --- Custom Error for Retry Logic ---
    class PathNotFoundError extends Error {
        constructor(message) {
            super(message);
            this.name = "PathNotFoundError";
        }
    }
    class OverpassError extends Error {
        constructor(message) {
            super(message);
            this.name = "OverpassError";
        }
    }

    // --- DOM Elements ---
    const startAddressInput = document.getElementById('startAddress');
    const endAddressInput = document.getElementById('endAddress');
    const findRouteBtn = document.getElementById('findRouteBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const replayBtn = document.getElementById('replayBtn');
    const statusPanel = document.getElementById('statusPanel');
    const routeInfoPanel = document.getElementById('route-info');
    const primaryMetricLabel = document.getElementById('primary-metric-label');
    const primaryMetricValue = document.getElementById('primary-metric-value');
    const secondaryMetricLabel = document.getElementById('secondary-metric-label');
    const secondaryMetricValue = document.getElementById('secondary-metric-value');
    const nodesExploredEl = document.getElementById('nodes-explored');
    const animationSpeedSlider = document.getElementById('animationSpeed');

    // --- State Variables ---
    let map, startMarker, endMarker, finalPathLayer, snapLinesLayer, animationCanvasLayer;
    let aStarWorker = null;
    let animationLog = [];
    let lastFinalPathCoords = [];
    let isReplaying = false;

    // --- Constants ---
    const DEFAULT_SPEEDS_KMH = { motorway: 110, trunk: 90, primary: 80, secondary: 70, tertiary: 50, unclassified: 40, residential: 30, motorway_link: 60, trunk_link: 50, primary_link: 40, secondary_link: 40, tertiary_link: 30, living_street: 10, service: 10, default: 40 };
    const MAX_SPEED_KMH = Math.max(...Object.values(DEFAULT_SPEEDS_KMH));
    const MAX_SPEED_MS = MAX_SPEED_KMH * 1000 / 3600;
    const OVERPASS_ENDPOINTS = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.openstreetmap.ru/cgi/interpreter"
    ];
    const GRID_DIM = 2;

    // --- Core Functions ---
    function initMap() {
        map = L.map('map').setView([39.8283, -98.5795], 4);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 20 }).addTo(map);
    }

    function updateStatus(message, isError = false) { statusPanel.innerHTML = message; statusPanel.className = `mt-2 text-sm p-3 rounded-lg min-h-[120px] ${isError ? 'bg-red-900/50 text-red-300' : 'bg-gray-800 text-gray-400'}`; }
    function setLoading(isLoading) {
        findRouteBtn.disabled = isLoading;
        replayBtn.classList.add('hidden');
        findRouteBtn.classList.toggle('hidden', isLoading);
        cancelBtn.classList.toggle('hidden', !isLoading);
    }
    function haversineDistance(c1, c2) { const R=6371e3,p1=c1.lat*Math.PI/180,p2=c2.lat*Math.PI/180,dp=(c2.lat-c1.lat)*Math.PI/180,dl=(c2.lon-c1.lon)*Math.PI/180,a=Math.sin(dp/2)*Math.sin(dp/2)+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)*Math.sin(dl/2);return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)) }

    async function geocodeAddress(address) {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
        const response = await fetch(url, { headers: { 'User-Agent': 'RouteVisualizer/1.0' }});
        if (!response.ok) throw new Error(`Geocoding failed: ${response.statusText}`);
        const data = await response.json();
        if (!data.length) throw new Error(`Address not found: "${address}"`);
        return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }

    async function getRoadNetworkTiled(bounds, startCoords, endCoords) {
        const mergedElements = new Map();
        const totalTiles = GRID_DIM * GRID_DIM;
        let currentTile = 1;

        const latStep = (bounds.getNorth() - bounds.getSouth()) / GRID_DIM;
        const lonStep = (bounds.getEast() - bounds.getWest()) / GRID_DIM;

        for (let i = 0; i < GRID_DIM; i++) {
            for (let j = 0; j < GRID_DIM; j++) {
                const south = bounds.getSouth() + i * latStep;
                const north = south + latStep;
                const west = bounds.getWest() + j * lonStep;
                const east = west + lonStep;
                
                const tileBbox = `${south},${west},${north},${east}`;
                
                updateStatus(`Downloading road data for tile ${currentTile} of ${totalTiles}...`);
                
                const tileData = await fetchTileData(tileBbox, startCoords, endCoords);
                tileData.elements.forEach(el => {
                    if (!mergedElements.has(el.id)) {
                        mergedElements.set(el.id, el);
                    }
                });
                currentTile++;
            }
        }
        return { elements: Array.from(mergedElements.values()) };
    }
    
    async function getRoadNetworkSingle(bounds, startCoords, endCoords) {
        updateStatus('Downloading road data...');
        const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
        return await fetchTileData(bbox, startCoords, endCoords);
    }

    async function fetchTileData(bbox, startCoords, endCoords) {
        const timeout = 90;
        const highDetailRadius = 2000;
        const mediumDetailRadius = 10000;
        
        const highDetailRoads = "^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|.*_link)$";
        const mediumDetailRoads = "^(motorway|trunk|primary|secondary|tertiary|.*_link)$";
        const lowDetailRoads = "^(motorway|trunk|primary|secondary|motorway_link|trunk_link|primary_link|secondary_link)$";

        const query = `
          [out:json][timeout:${timeout}];
          (
            way[highway~"${highDetailRoads}"](around:${highDetailRadius},${startCoords.lat},${startCoords.lon});
            way[highway~"${highDetailRoads}"](around:${highDetailRadius},${endCoords.lat},${endCoords.lon});
            way[highway~"${mediumDetailRoads}"](around:${mediumDetailRadius},${startCoords.lat},${startCoords.lon});
            way[highway~"${mediumDetailRoads}"](around:${mediumDetailRadius},${endCoords.lat},${endCoords.lon});
            way[highway~"${lowDetailRoads}"](${bbox});
          );
          out body;
          >;
          out skel qt;
        `;

        for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
            const endpoint = OVERPASS_ENDPOINTS[i];
            const serverName = new URL(endpoint).hostname;
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    body: `data=${encodeURIComponent(query.trim())}`
                });
                if (!response.ok) throw new Error(`Server ${serverName} returned status ${response.status}`);
                const responseText = await response.text();
                if (!responseText) throw new Error(`Server ${serverName} returned an empty response.`);
                return JSON.parse(responseText);
            } catch (error) {
                console.error(`Attempt ${i + 1} failed for ${serverName}:`, error);
                if (i >= OVERPASS_ENDPOINTS.length - 1) {
                    throw new OverpassError("All map data servers failed. Please try again later.");
                }
            }
        }
    }

    function buildGraph(osmData) {
        updateStatus("Building road graph...");
        const nodes = new Map();
        osmData.elements.filter(e => e.type === 'node').forEach(node => { nodes.set(node.id, { id: node.id, lat: node.lat, lon: node.lon, adj: new Map() }); });
        
        osmData.elements.filter(e => e.type === 'way').forEach(way => {
            const roadType = way.tags.highway || 'default';
            let speedKmh = DEFAULT_SPEEDS_KMH[roadType] || DEFAULT_SPEEDS_KMH.default;
            if (way.tags.maxspeed) {
                const speedMatch = way.tags.maxspeed.match(/\d+/);
                if (speedMatch) { let ps = parseInt(speedMatch[0], 10); if (way.tags.maxspeed.includes('mph')) ps *= 1.60934; speedKmh = ps; }
            }
            const speedMs = speedKmh * 1000 / 3600;

            const isOneWay = way.tags.oneway === 'yes' || way.tags.oneway === '1';
            const isReversed = way.tags.oneway === '-1';
            const isImplicitlyOneWay = way.tags.junction === 'roundabout' || (way.tags.highway && way.tags.highway.includes('motorway') && way.tags.oneway !== 'no');

            let congestionFactor = 1.0;
            const lanes = parseInt(way.tags.lanes, 10);
            if (!isNaN(lanes)) {
                if (lanes === 1) congestionFactor = 1.15;
                else if (lanes === 2) congestionFactor = 1.05;
                else if (lanes >= 4) congestionFactor = 0.9;
            } else if (roadType === 'motorway' || roadType === 'motorway_link') {
                congestionFactor = 0.9; 
            }

            for (let i = 0; i < way.nodes.length - 1; i++) {
                const nodeA = nodes.get(way.nodes[i]);
                const nodeB = nodes.get(way.nodes[i+1]);
                if (nodeA && nodeB) {
                    const distance = haversineDistance(nodeA, nodeB);
                    const time = (distance / speedMs) * congestionFactor;
                    const cost = { time, distance };
                    
                    if (isReversed) {
                        nodeB.adj.set(nodeA.id, cost);
                    } else if (isOneWay || isImplicitlyOneWay) {
                        nodeA.adj.set(nodeB.id, cost);
                    } else {
                        nodeA.adj.set(nodeB.id, cost);
                        nodeB.adj.set(nodeA.id, cost);
                    }
                }
            }
        });
        return nodes;
    }

    function buildSpatialIndex(nodes, bounds) {
        const SPATIAL_INDEX_GRID_SIZE = 100;
        const grid = new Array(SPATIAL_INDEX_GRID_SIZE * SPATIAL_INDEX_GRID_SIZE).fill(null).map(() => []);
        const nodesArray = Array.from(nodes.values());

        if (nodesArray.length === 0) {
            return { getNearbyNodes: () => [] };
        }

        const minLat = bounds.getSouth();
        const minLon = bounds.getWest();
        const latRange = bounds.getNorth() - minLat;
        const lonRange = bounds.getEast() - minLon;

        const latCellSize = latRange / SPATIAL_INDEX_GRID_SIZE;
        const lonCellSize = lonRange / SPATIAL_INDEX_GRID_SIZE;

        if (latCellSize === 0 || lonCellSize === 0) {
            return { getNearbyNodes: () => nodesArray };
        }

        for (const node of nodesArray) {
            const x = Math.min(SPATIAL_INDEX_GRID_SIZE - 1, Math.floor((node.lat - minLat) / latCellSize));
                        const y = Math.min(SPATIAL_INDEX_GRID_SIZE - 1, Math.floor((node.lon - minLon) / lonCellSize));
            const gridIndex = x * SPATIAL_INDEX_GRID_SIZE + y;
            if (grid[gridIndex]) {
                grid[gridIndex].push(node);
            }
        }

        return {
            getNearbyNodes: (coords) => {
                const x = Math.min(SPATIAL_INDEX_GRID_SIZE - 1, Math.max(0, Math.floor((coords.lat - minLat) / latCellSize)));
                const y = Math.min(SPATIAL_INDEX_GRID_SIZE - 1, Math.max(0, Math.floor((coords.lon - minLon) / lonCellSize)));
                
                const candidates = [];
                for (let i = -1; i <= 1; i++) {
                    for (let j = -1; j <= 1; j++) {
                        const newX = x + i;
                        const newY = y + j;
                        if (newX >= 0 && newX < SPATIAL_INDEX_GRID_SIZE && newY >= 0 && newY < SPATIAL_INDEX_GRID_SIZE) {
                            candidates.push(...grid[newX * SPATIAL_INDEX_GRID_SIZE + newY]);
                        }
                    }
                }
                return candidates.length > 0 ? candidates : nodesArray;
            }
        };
    }

    function findNearestNode(coords, spatialIndex) {
        let nearestNode = null, minDistance = Infinity;
        const nodesToSearch = spatialIndex.getNearbyNodes(coords);

        if (nodesToSearch.length === 0) return null;

        for(const node of nodesToSearch) {
            const d = haversineDistance(coords, node);
            if (d < minDistance) {
                minDistance = d;
                nearestNode = node;
            }
        }

        if (minDistance > 20000) {
             console.warn(`Could not find a road node within 20km of the address. Closest was ${minDistance.toFixed(0)}m away.`);
             return null;
        }

        return nearestNode;
    }

    function drawFinalPath(pathNodes, mode, graph) {
        let totalDistance = 0, totalTime = 0;
        for(let i=0; i < pathNodes.length - 1; i++){
            const from = pathNodes[i];
            const to = pathNodes[i+1];
            const fromNodeInGraph = graph.get(from.id);
            if (fromNodeInGraph) {
                const edge = fromNodeInGraph.adj.get(to.id);
                if(edge) { totalDistance += edge.distance; totalTime += edge.time; }
            }
        }
        
        const finalPathCoords = pathNodes.map(n => [n.lat, n.lon]);
        lastFinalPathCoords = finalPathCoords; 
        
        const formatTime = (seconds) => {
            if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
            return `${(seconds / 3600).toFixed(1)} hours`;
        };

        if (mode === 'time') {
            primaryMetricLabel.textContent = "Travel Time";
            primaryMetricValue.textContent = formatTime(totalTime);
            secondaryMetricLabel.textContent = "Distance";
            secondaryMetricValue.textContent = `${(totalDistance / 1000).toFixed(2)} km`;
        } else {
            primaryMetricLabel.textContent = "Distance";
            primaryMetricValue.textContent = `${(totalDistance / 1000).toFixed(2)} km`;
            secondaryMetricLabel.textContent = "Travel Time";
            secondaryMetricValue.textContent = formatTime(totalTime);
        }
        
        let totalNodes = 0;
        animationLog.forEach(batch => totalNodes += batch.length);
        nodesExploredEl.textContent = totalNodes.toLocaleString();
        routeInfoPanel.classList.remove('hidden');

        if (finalPathLayer) map.removeLayer(finalPathLayer);
        finalPathLayer = L.polyline(finalPathCoords, { color: '#facc15', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    }
    
    function cleanupMap(clearAll = true) {
         if (animationCanvasLayer) {
            try {
                map.removeLayer(animationCanvasLayer);
            } catch (error) {
                console.warn("Error removing canvas layer:", error);
            }
            animationCanvasLayer = null;
        }
         if(clearAll) {
            map.eachLayer(layer => { if (layer instanceof L.Polyline || layer instanceof L.Marker) map.removeLayer(layer); });
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 20 }).addTo(map);
         } else {
            if(finalPathLayer) map.removeLayer(finalPathLayer);
            map.eachLayer(layer => { if(layer.options.pane === 'overlayPane' && layer !== snapLinesLayer && layer !== startMarker && layer !== endMarker) map.removeLayer(layer); });
         }
    }

            let activeAnimationInterval = null;

    function stopAnimation() {
        if (activeAnimationInterval) {
            clearInterval(activeAnimationInterval);
            activeAnimationInterval = null;
        }
    }

    async function playAnimation(log) {
        stopAnimation(); 
        cleanupMap(false);

        // Check if animation log is empty
        if (!log || log.length === 0) {
            console.warn("Animation log is empty, skipping animation");
            return Promise.resolve();
        }

        const allSegments = log.flatMap(batch => batch.map(segment => [
            [segment.from.lat, segment.from.lon],
            [segment.to.lat, segment.to.lon]
        ]));

        // Check if segments were created successfully
        if (allSegments.length === 0) {
            console.warn("No animation segments found, skipping animation");
            return Promise.resolve();
        }

        const speedValue = parseInt(animationSpeedSlider.value, 10);

        const minDelay = 8;
        const maxDelay = 200;
        const delay = Math.round(minDelay + ((maxDelay - minDelay) * (10 - speedValue) / 9));

        const minSegmentsPerTick = 5;
        const maxSegmentsPerTick = Math.max(500, Math.ceil(allSegments.length / 10)); 
        const segmentsPerTick = Math.round(minSegmentsPerTick + ((maxSegmentsPerTick - minSegmentsPerTick) * (speedValue - 1) / 9));

        let currentIndex = 0;

        animationCanvasLayer = L.canvasLayer({
            render: function(ctx, info) {
                try {
                    ctx.clearRect(0, 0, info.size.x, info.size.y);
                    
                    // Draw explored paths (red)
                    ctx.strokeStyle = 'rgba(220, 38, 38, 0.6)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    for (let i = 0; i < currentIndex; i++) {
                        const segment = allSegments[i];
                        if (segment && segment.length === 2) {
                            const p1 = info.map.latLngToContainerPoint(segment[0]);
                            const p2 = info.map.latLngToContainerPoint(segment[1]);
                            if (p1 && p2 && !isNaN(p1.x) && !isNaN(p1.y) && !isNaN(p2.x) && !isNaN(p2.y)) {
                                ctx.moveTo(p1.x, p1.y);
                                ctx.lineTo(p2.x, p2.y);
                            }
                        }
                    }
                    ctx.stroke();

                    // Draw frontier (orange)
                    const frontierStart = Math.max(0, currentIndex - segmentsPerTick);
                    ctx.strokeStyle = 'rgba(249, 115, 22, 0.8)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    for (let i = frontierStart; i < currentIndex; i++) {
                         const segment = allSegments[i];
                         if (segment && segment.length === 2) {
                            const p1 = info.map.latLngToContainerPoint(segment[0]);
                            const p2 = info.map.latLngToContainerPoint(segment[1]);
                            if (p1 && p2 && !isNaN(p1.x) && !isNaN(p1.y) && !isNaN(p2.x) && !isNaN(p2.y)) {
                                ctx.moveTo(p1.x, p1.y);
                                ctx.lineTo(p2.x, p2.y);
                            }
                         }
                    }
                    ctx.stroke();
                } catch (error) {
                    console.error("Error during canvas rendering:", error);
                }
            }
        }).addTo(map);

        return new Promise(resolve => {
            activeAnimationInterval = setInterval(() => {
                try {
                    if (currentIndex >= allSegments.length) {
                        stopAnimation();
                        // Force a final canvas update
                        if (animationCanvasLayer && animationCanvasLayer._renderer) {
                            animationCanvasLayer._update();
                        }
                        resolve();
                        return;
                    }
                    
                    currentIndex = Math.min(currentIndex + segmentsPerTick, allSegments.length);
                    
                    // Trigger canvas update
                    if (animationCanvasLayer && animationCanvasLayer._renderer) {
                        animationCanvasLayer._update();
                    }
                } catch (error) {
                    console.error("Error during animation interval:", error);
                    stopAnimation();
                    resolve();
                }

            }, delay);
        });
    }

    async function findRouteAttempt(padding, startCoords, endCoords, routingMode) {
        const initialBounds = L.latLngBounds([startCoords.lat, startCoords.lon], [endCoords.lat, endCoords.lon]);
        const center = initialBounds.getCenter();
        const latSpan = initialBounds.getNorth() - initialBounds.getSouth();
        const lngSpan = initialBounds.getEast() - initialBounds.getWest();
        const maxSpan = Math.max(latSpan, lngSpan);
        const halfSpan = maxSpan / 2;
        const southWest = L.latLng(center.lat - halfSpan, center.lng - halfSpan);
        const northEast = L.latLng(center.lat + halfSpan, center.lng + halfSpan);
        const squareBounds = L.latLngBounds(southWest, northEast);
        const bounds = squareBounds.pad(padding);

        map.fitBounds(bounds);

        let osmData;
        try {
            osmData = await getRoadNetworkSingle(bounds, startCoords, endCoords);
        } catch (error) {
            if (error instanceof OverpassError) {
                console.warn("Single request failed, falling back to tiled fetching.");
                updateStatus("Initial request failed. Splitting area into smaller tiles...");
                osmData = await getRoadNetworkTiled(bounds, startCoords, endCoords);
            } else {
                throw error;
            }
        }
        
        const graph = buildGraph(osmData);
        const spatialIndex = buildSpatialIndex(graph, bounds);
        
        if (graph.size === 0) {
            throw new Error("Failed to build road graph. The downloaded map data may be empty or invalid.");
        }

        updateStatus("Snapping addresses to nearest roads...");
        const startNode = findNearestNode(startCoords, spatialIndex);
        const endNode = findNearestNode(endCoords, spatialIndex);
        if (!startNode || !endNode) {
            throw new PathNotFoundError("Could not find nearby roads. The map area might be too small.");
        }

        if (snapLinesLayer) map.removeLayer(snapLinesLayer);
        snapLinesLayer = L.layerGroup([
            L.polyline([startMarker.getLatLng(), [startNode.lat, startNode.lon]], {color: 'white', weight: 1, opacity: 0.7, dashArray: '5, 5'}),
            L.polyline([endMarker.getLatLng(), [endNode.lat, endNode.lon]], {color: 'white', weight: 1, opacity: 0.7, dashArray: '5, 5'})
        ]).addTo(map);

        updateStatus(`Calculating route... (exploring ${graph.size.toLocaleString()} nodes)`);
        
        return new Promise((resolve, reject) => {
            aStarWorker = new Worker('worker.js');
            
            aStarWorker.onmessage = async (e) => {
                const { type, payload } = e.data;
                if (type === 'done') {
                    animationLog = payload.log; 
                    updateStatus("Route found! Preparing animation...");
                    await playAnimation(animationLog);
                    drawFinalPath(payload.finalPath, routingMode, graph);
                    updateStatus("Visualization complete!");
                    resolve();
                } else if (type === 'error') {
                    reject(new PathNotFoundError(payload));
                }
            };
            
            aStarWorker.onerror = (e) => reject(new Error(`Error in A* Worker: ${e.message}`));

            const graphData = Array.from(graph.entries()).map(([id, node]) => {
                const adj = Array.from(node.adj.entries());
                return [id, { ...node, adj }];
            });
            aStarWorker.postMessage({ graphData, startNodeId: startNode.id, endNodeId: endNode.id, mode: routingMode, MAX_SPEED_MS });
        });
    }

        async function handleFindRoute() {
        if(isReplaying) return;
        stopAnimation();
        cleanupMap();
        setLoading(true);
        routeInfoPanel.classList.add('hidden');
        animationLog = [];
        lastFinalPathCoords = [];
        
        try {
            const routingMode = document.querySelector('input[name="routingMode"]:checked').value;
            updateStatus(`Geocoding addresses...`);
            const startCoords = await geocodeAddress(startAddressInput.value);
            const endCoords = await geocodeAddress(endAddressInput.value);
            
            if (startMarker) map.removeLayer(startMarker);
            if (endMarker) map.removeLayer(endMarker);
            startMarker = L.marker([startCoords.lat, startCoords.lon]).addTo(map).bindPopup("Start");
            endMarker = L.marker([endCoords.lat, endCoords.lon]).addTo(map).bindPopup("End");

            const directDistance = haversineDistance(startCoords, endCoords) / 1000;

            try {
                const initialPadding = directDistance > 75 ? 0.1 : 0.2;
                await findRouteAttempt(initialPadding, startCoords, endCoords, routingMode);
            } catch (error) {
                if (error instanceof PathNotFoundError) {
                    console.warn("Initial attempt failed:", error.message, "Retrying with larger bounding box.");
                    updateStatus("Could not find route. Retrying with a larger map area...");
                    const retryPadding = directDistance > 75 ? 0.4 : 0.5;
                    await findRouteAttempt(retryPadding, startCoords, endCoords, routingMode);
                } else {
                    throw error;
                }
            }

            setLoading(false);
            // Only show replay button if we have animation data
            if (animationLog && animationLog.length > 0) {
                replayBtn.classList.remove('hidden');
                console.log("Replay button enabled with", animationLog.length, "animation batches");
            } else {
                console.warn("No animation data available for replay");
            }
            if (aStarWorker) { aStarWorker.terminate(); aStarWorker = null; }

        } catch (error) {
            console.error(error);
            updateStatus(`Error: ${error.message}`, true);
            setLoading(false);
            if (aStarWorker) { aStarWorker.terminate(); aStarWorker = null; }
        }
    }

    async function handleReplay() {
        if(isReplaying || animationLog.length === 0) {
            console.warn("Cannot replay: already replaying or no animation log available");
            return;
        }
        
        console.log("Starting replay with", animationLog.length, "animation batches");
        isReplaying = true;
        
        updateStatus("Replaying search...");
        findRouteBtn.disabled = true;
        replayBtn.disabled = true;

        try {
            await playAnimation(animationLog);

            // Redraw the final path after animation completes
            if (lastFinalPathCoords.length > 0) {
                if (finalPathLayer) map.removeLayer(finalPathLayer);
                finalPathLayer = L.polyline(lastFinalPathCoords, { 
                    color: '#facc15', 
                    weight: 6, 
                    opacity: 1, 
                    lineCap: 'round', 
                    lineJoin: 'round' 
                }).addTo(map);
                console.log("Final path redrawn");
            }
            
            updateStatus("Replay complete!");
        } catch (error) {
            console.error("Error during replay:", error);
            updateStatus("Replay failed. Please try again.", true);
        } finally {
            isReplaying = false;
            findRouteBtn.disabled = false;
            replayBtn.disabled = false;
        }
    }

        cancelBtn.addEventListener('click', () => {
        if (aStarWorker) { aStarWorker.terminate(); aStarWorker = null; }
        stopAnimation();
        setLoading(false);
        replayBtn.classList.add('hidden');
        updateStatus("Search cancelled. Ready for new route.");
    });

    findRouteBtn.addEventListener('click', handleFindRoute);
    replayBtn.addEventListener('click', handleReplay);
    initMap();
});
