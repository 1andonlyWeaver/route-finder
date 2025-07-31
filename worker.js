// A* worker logic
class PriorityQueue {
    constructor(comparator = (a, b) => a > b) { this._heap = []; this._comparator = comparator; }
    size() { return this._heap.length; }
    isEmpty() { return this.size() === 0; }
    peek() { return this._heap[0]; }
    _parent(i) { return Math.floor((i - 1) / 2); }
    _leftChild(i) { return 2 * i + 1; }
    _rightChild(i) { return 2 * i + 2; }
    _swap(i, j) { [this._heap[i], this._heap[j]] = [this._heap[j], this._heap[i]]; }
    _compare(i, j) { return this._comparator(this._heap[i], this._heap[j]); }
    push(value) { this._heap.push(value); this._siftUp(); return this.size(); }
    _siftUp() { let i = this.size() - 1; while (i > 0 && this._compare(i, this._parent(i))) { this._swap(i, this._parent(i)); i = this._parent(i); } }
    pop() { if (this.size() > 1) { this._swap(0, this.size() - 1); } const val = this._heap.pop(); this._siftDown(); return val; }
    _siftDown() { let i = 0; while ((this._leftChild(i) < this.size() && this._compare(this._leftChild(i), i)) || (this._rightChild(i) < this.size() && this._compare(this._rightChild(i), i))) { const child = this._rightChild(i) < this.size() && this._compare(this._rightChild(i), this._leftChild(i)) ? this._rightChild(i) : this._leftChild(i); this._swap(i, child); i = child; } }
}

function haversineDistance(c1, c2) {
    const R = 6371e3;
    const p1 = c1.lat * Math.PI / 180, p2 = c2.lat * Math.PI / 180;
    const dp = (c2.lat - c1.lat) * Math.PI / 180, dl = (c2.lon - c1.lon) * Math.PI / 180;
    const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

self.onmessage = function(e) {
    const { graphData, startNodeId, endNodeId, mode, MAX_SPEED_MS } = e.data;
    
    const graph = new Map(graphData.map(([id, node]) => {
        return [id, { ...node, adj: new Map(node.adj) }];
    }));
    const startNode = graph.get(startNodeId);
    const endNode = graph.get(endNodeId);
    
    if (!startNode || !endNode) {
        self.postMessage({ type: 'error', payload: 'Start or end node not found in graph.' });
        return;
    }

    const openSet = new PriorityQueue((a, b) => a.f < b.f);
    const openSetMap = new Map();
    startNode.g = 0;
    startNode.h = mode === 'time' ? haversineDistance(startNode, endNode) / MAX_SPEED_MS : haversineDistance(startNode, endNode);
    startNode.f = startNode.h;
    openSet.push(startNode);
    openSetMap.set(startNode.id, startNode);

    const closedSet = new Set();
    let animationLog = [];
    const BATCH_SIZE = 500;
    let pathBatch = [];

    while (!openSet.isEmpty()) {
        const current = openSet.pop();
        openSetMap.delete(current.id);

        if (current.id === endNode.id) {
            if (pathBatch.length > 0) animationLog.push(pathBatch);

            const finalPath = [];
            let temp = current;
            while (temp) {
                finalPath.push({ id: temp.id, lat: temp.lat, lon: temp.lon });
                temp = temp.parent;
            }
            finalPath.reverse();
            
            self.postMessage({ type: 'done', payload: { log: animationLog, finalPath: finalPath } });
            return;
        }

        closedSet.add(current.id);

        if (current.parent) {
            pathBatch.push({
                from: { lat: current.parent.lat, lon: current.parent.lon },
                to: { lat: current.lat, lon: current.lon }
            });
        }
        
        if (pathBatch.length >= BATCH_SIZE) {
            animationLog.push(pathBatch);
            pathBatch = [];
        }
        
        for (const [neighborId, cost] of current.adj.entries()) {
            if (closedSet.has(neighborId)) continue;
            const neighbor = graph.get(neighborId);
            if (!neighbor) continue;

            const cost_g = mode === 'time' ? cost.time : cost.distance;
            const tentative_g = current.g + cost_g;
            
            const existingNeighbor = openSetMap.get(neighborId);
            if (!existingNeighbor || tentative_g < existingNeighbor.g) {
                const newNeighbor = { ...neighbor, g: tentative_g, parent: current };
                newNeighbor.h = mode === 'time' ? haversineDistance(newNeighbor, endNode) / MAX_SPEED_MS : haversineDistance(newNeighbor, endNode);
                newNeighbor.f = newNeighbor.g + newNeighbor.h;
                
                openSet.push(newNeighbor);
                openSetMap.set(neighborId, newNeighbor);
            }
        }
    }
    self.postMessage({ type: 'error', payload: 'No path could be found.' });
};