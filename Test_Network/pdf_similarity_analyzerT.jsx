const { useState, useEffect, useCallback, useMemo, useRef } = React;

// --- 1. SVG Icon Components ---

const FileTextIcon = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
);

const UploadCloudIcon = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
        <path d="M12 12v9" />
        <path d="m16 16-4-4-4 4" />
    </svg>
);

const DownloadIcon = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
);

const AlertTriangleIcon = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>
);

const XIcon = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
);


// --- 2. Helper Functions ---

// Singleton class to handle loading the ML model pipeline
class PipelineSingleton {
    static task = 'feature-extraction';
    static model = 'Xenova/all-MiniLM-L6-v2';
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1');
            this.instance = pipeline(this.task, this.model, { progress_callback });
        }
        return this.instance;
    }
}


const ENGLISH_STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can\'t', 'cannot', 'could',
  'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during', 'each', 'few', 'for',
  'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s',
  'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i', 'i\'d', 'i\'ll', 'i\'m',
  'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most', 'mustn\'t',
  'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours',
  'ourselves', 'out', 'over', 'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should', 'shouldn\'t',
  'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
  'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t',
  'what', 'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom', 'why', 'why\'s',
  'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself',
  'yourselves', 'page', 'document'
]);

const BIBLIOGRAPHY_KEYWORDS = ['references', 'bibliography', 'works cited', 'literature cited'];
const ABSTRACT_KEYWORDS = ['abstract', 'summary'];
const INTRODUCTION_KEYWORDS = ['introduction', '1.', 'i.'];

/**
 * Extracts the abstract from the text.
 * @param {string} text - The full text content.
 * @returns {string} - The extracted abstract or a fallback message.
 */
const extractAbstract = (text) => {
    const lowerCaseText = text.toLowerCase();
    let abstractStartIndex = -1;

    for (const keyword of ABSTRACT_KEYWORDS) {
        const index = lowerCaseText.indexOf(keyword);
        if (index !== -1 && index < text.length * 0.1) { // Must be near the beginning
            abstractStartIndex = index + keyword.length;
            break;
        }
    }

    if (abstractStartIndex === -1) return "Abstract not found.";

    let abstractEndIndex = -1;
    for (const keyword of INTRODUCTION_KEYWORDS) {
        const index = lowerCaseText.indexOf(`\n${keyword}`, abstractStartIndex);
        if (index !== -1) {
            abstractEndIndex = index;
            break;
        }
    }

    if (abstractEndIndex === -1) {
        abstractEndIndex = abstractStartIndex + 1500;
    }

    let abstract = text.substring(abstractStartIndex, abstractEndIndex).trim();
    abstract = abstract.replace(/^[^a-zA-Z]+/, '');

    return abstract.length > 20 ? abstract : "Abstract not found.";
};

/**
 * Attempts to remove the bibliography section from a text.
 */
const removeBibliography = (text) => {
    const lowerCaseText = text.toLowerCase();
    let splitIndex = -1;

    for (const keyword of BIBLIOGRAPHY_KEYWORDS) {
        const lastIndex = lowerCaseText.lastIndexOf(`\n${keyword}\n`);
        if (lastIndex > splitIndex) {
            splitIndex = lastIndex;
        }
    }

    if (splitIndex !== -1) {
        if (splitIndex > text.length * 0.6) {
            return text.substring(0, splitIndex);
        }
    }

    return text;
};

/**
 * Extracts the top 5 most relevant keyword descriptors from a text.
 */
const extractDescriptorsFromText = (text) => {
    if (!text) return [];
    const wordCounts = new Map();
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];

    for (const word of words) {
        if (word.length >= 4 && !ENGLISH_STOP_WORDS.has(word)) {
            wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
        }
    }

    return Array.from(wordCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(entry => entry[0]);
};


/**
 * Creates a simple hash from a string to detect duplicates.
 */
const createSimpleHash = (text) => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
    }
    return hash;
};

/**
 * Calculates the Cosine Similarity between two dense vectors (arrays).
 */
const cosineSimilarity = (vecA, vecB) => {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    if (!vecA || !vecB || vecA.length !== vecB.length) {
        console.error("Vector dimensions do not match or vectors are invalid!");
        return 0;
    }

    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        magnitudeA += vecA[i] * vecA[i];
        magnitudeB += vecB[i] * vecB[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) return 0;

    return dotProduct / (magnitudeA * magnitudeB);
};

/**
 * Finds all connected components in a graph using BFS.
 */
const findConnectedComponents = (documents, proximityMatrix) => {
    const adj = new Map();
    documents.forEach(doc => adj.set(doc.id, []));
    proximityMatrix.forEach(({ source, target }) => {
        adj.get(source).push(target);
        adj.get(target).push(source);
    });

    const visited = new Set();
    const components = [];

    documents.forEach(doc => {
        if (!visited.has(doc.id)) {
            const component = [];
            const queue = [doc.id];
            visited.add(doc.id);
            while (queue.length > 0) {
                const node = queue.shift();
                component.push(node);
                for (const neighbor of adj.get(node) || []) {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        queue.push(neighbor);
                    }
                }
            }
            components.push(component);
        }
    });
    return components;
};

/**
 * Computes the convex hull of a set of points using the Monotone Chain algorithm.
 */
const computeConvexHull = (points) => {
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    const lower = [];
    for (const p of points) {
        while (lower.length >= 2 && cross_product(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
            lower.pop();
        }
        lower.push(p);
    }
    const upper = [];
    for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        while (upper.length >= 2 && cross_product(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
            upper.pop();
        }
        upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
};

const cross_product = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);


/**
 * Finds the shortest path between two nodes using Breadth-First Search.
 */
const findShortestPath = (sourceId, targetId, adj) => {
    const queue = [[sourceId]];
    const visited = new Set([sourceId]);
    while (queue.length > 0) {
        const path = queue.shift();
        const node = path[path.length - 1];
        if (node === targetId) return path;
        for (const neighbor of adj.get(node) || []) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                const newPath = [...path, neighbor];
                queue.push(newPath);
            }
        }
    }
    return null; // No path found
};

// --- 3. UI Components ---

const AlertMessage = ({ message, onDismiss, type = 'error' }) => {
    if (!message) return null;
    const colors = {
        error: { bg: 'bg-red-900', border: 'border-red-700', text: 'text-red-200', icon: <AlertTriangleIcon className="h-6 w-6 text-red-400" /> },
        info: { bg: 'bg-blue-900', border: 'border-blue-700', text: 'text-blue-200', icon: <FileTextIcon className="h-6 w-6 text-blue-400" /> }
    }
    const color = colors[type];

    return (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-full max-w-md z-50 p-4 animate-fade-in-up">
            <div className={`${color.bg} border ${color.border} ${color.text} p-4 rounded-lg shadow-2xl flex items-center gap-4`}>
                {color.icon}
                <p className="flex-grow">{message}</p>
                <button onClick={onDismiss} className="p-1 rounded-full hover:bg-black/20 transition-colors"><XIcon className="h-5 w-5"/></button>
            </div>
        </div>
    );
};

/**
 * GraphViewer: Renders and manages the interactive force-directed graph.
 */
const GraphViewer = ({ documents, proximityMatrix, onSelect, selectedElement, pathNodes, highlightedPath, similarityThreshold, clusters, setFocusedCluster, focusedCluster }) => {
    const svgRef = useRef(null);
    const [nodePositions, setNodePositions] = useState({});
    const [isDragging, setIsDragging] = useState(null);
    const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
    const isPanning = useRef(false);
    const panStart = useRef({ x: 0, y: 0 });
    const animationFrameRef = useRef();
    const [simulationActive, setSimulationActive] = useState(true);
    const energyRef = useRef(0);
    const dragInfo = useRef(null);

    const visibleNodes = useMemo(() => {
        if (!focusedCluster) return new Set(documents.map(d => d.id));
        return new Set(clusters[focusedCluster.index]);
    }, [focusedCluster, documents, clusters]);

    const visibleProximityMatrix = useMemo(() => {
        if (!focusedCluster) return proximityMatrix;
        return proximityMatrix.filter(edge => visibleNodes.has(edge.source) && visibleNodes.has(edge.target));
    }, [focusedCluster, proximityMatrix, visibleNodes]);

    const nodeDegrees = useMemo(() => {
        const degrees = new Map(documents.map(d => [d.id, 0]));
        proximityMatrix.forEach(({ source, target }) => {
            degrees.set(source, degrees.get(source) + 1);
            degrees.set(target, degrees.get(target) + 1);
        });
        return degrees;
    }, [documents, proximityMatrix]);

    const getNodeRadius = useCallback((docId) => {
        const degree = nodeDegrees.get(docId) || 0;
        return 8 + Math.log(degree + 1) * 2;
    }, [nodeDegrees]);

    useEffect(() => {
        if (!svgRef.current) return;
        const { width, height } = svgRef.current.getBoundingClientRect();

        setNodePositions(prev => {
            const newPositions = {...prev};
            documents.forEach(doc => {
                if (!newPositions[doc.id]) {
                     newPositions[doc.id] = {
                        x: width / 2 + (Math.random() - 0.5) * 100,
                        y: height / 2 + (Math.random() - 0.5) * 100,
                        vx: 0,
                        vy: 0,
                    };
                }
            });
            return newPositions;
        });
        setSimulationActive(true);
    }, [documents]);

    useEffect(() => {
        if (!simulationActive) return;

        const { width, height } = svgRef.current.getBoundingClientRect();

        const nodeCount = visibleNodes.size;
        const REPULSION_STRENGTH = 2000 / Math.max(1, Math.sqrt(nodeCount));
        const STABILITY_THRESHOLD = 0.001 * nodeCount;

        const ATTRACTION_STRENGTH = 0.05;
        const IDEAL_DISTANCE = 150;
        const DAMPING = 0.9;

        const simulationStep = () => {
            setNodePositions(currentPositions => {
                if (Object.keys(currentPositions).length === 0) return {};

                const newPositions = JSON.parse(JSON.stringify(currentPositions));
                let totalKineticEnergy = 0;

                const currentDocs = documents.filter(d => visibleNodes.has(d.id));

                currentDocs.forEach(docA => {
                    newPositions[docA.id].vx *= DAMPING; newPositions[docA.id].vy *= DAMPING;
                    currentDocs.forEach(docB => {
                        if (docA.id === docB.id) return;
                        const posA = newPositions[docA.id]; const posB = newPositions[docB.id];
                        const dx = posA.x - posB.x; const dy = posA.y - posB.y;
                        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                        const force = REPULSION_STRENGTH / (distance * distance);
                        posA.vx += (dx / distance) * force; posA.vy += (dy / distance) * force;
                    });
                });

                visibleProximityMatrix.forEach(edge => {
                    const posA = newPositions[edge.source]; const posB = newPositions[edge.target];
                    if (!posA || !posB) return;
                    const dx = posB.x - posA.x; const dy = posB.y - posA.y;
                    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                    const displacement = distance - IDEAL_DISTANCE;
                    const force = ATTRACTION_STRENGTH * displacement;
                    const forceX = (dx / distance) * force; const forceY = (dy / distance) * force;
                    posA.vx += forceX; posA.vy += forceY;
                    posB.vx -= forceX; posB.vy -= forceY;
                });

                currentDocs.forEach(doc => {
                    if (isDragging && isDragging.id === doc.id) {
                         newPositions[doc.id].vx = 0; newPositions[doc.id].vy = 0;
                    } else {
                        const pos = newPositions[doc.id];
                        pos.x += pos.vx; pos.y += pos.vy;
                        pos.x = Math.max(15, Math.min(width - 15, pos.x));
                        pos.y = Math.max(15, Math.min(height - 15, pos.y));
                    }
                    totalKineticEnergy += (newPositions[doc.id].vx ** 2) + (newPositions[doc.id].vy ** 2);
                });

                energyRef.current = totalKineticEnergy;
                return newPositions;
            });

            if (energyRef.current < STABILITY_THRESHOLD && !isDragging) setSimulationActive(false);
            else animationFrameRef.current = requestAnimationFrame(simulationStep);
        };

        animationFrameRef.current = requestAnimationFrame(simulationStep);
        return () => cancelAnimationFrame(animationFrameRef.current);
    }, [simulationActive, documents, visibleProximityMatrix, isDragging, visibleNodes]);

    const handleNodeMouseDown = (e, docId) => {
        e.preventDefault(); e.stopPropagation();
        dragInfo.current = { startX: e.clientX, startY: e.clientY, moved: false };
        const { clientX, clientY } = e;
        const point = svgRef.current.createSVGPoint();
        point.x = clientX; point.y = clientY;
        const { x, y } = point.matrixTransform(svgRef.current.getScreenCTM().inverse());

        setIsDragging({ id: docId, offsetX: (x - transform.x)/transform.k - nodePositions[docId].x, offsetY: (y - transform.y)/transform.k - nodePositions[docId].y });
        onSelect({ type: 'node', id: docId });
    };

    const handleMouseMove = (e) => {
        if (isPanning.current) {
            setTransform(t => ({...t, x: t.x + e.clientX - panStart.current.x, y: t.y + e.clientY - panStart.current.y }));
            panStart.current = { x: e.clientX, y: e.clientY };
            return;
        }

        if (!isDragging) return;

        if (dragInfo.current && !dragInfo.current.moved) {
            const dx = e.clientX - dragInfo.current.startX; const dy = e.clientY - dragInfo.current.startY;
            if (Math.sqrt(dx * dx + dy * dy) > 5) {
                dragInfo.current.moved = true;
                setSimulationActive(true);
            }
        }
        if (dragInfo.current?.moved) {
            const { clientX, clientY } = e;
            const point = svgRef.current.createSVGPoint();
            point.x = clientX; point.y = clientY;
            const { x, y } = point.matrixTransform(svgRef.current.getScreenCTM().inverse());

            setNodePositions(prev => ({ ...prev, [isDragging.id]: { ...prev[isDragging.id], x: (x-transform.x)/transform.k - isDragging.offsetX, y: (y-transform.y)/transform.k - isDragging.offsetY } }));
        }
    };

    const handleMouseUp = () => {
        if (isDragging && dragInfo.current && !dragInfo.current.moved) setSimulationActive(false);
        setIsDragging(null); dragInfo.current = null;
        isPanning.current = false;
        svgRef.current.style.cursor = 'grab';
    };

    const handleWheel = (e) => {
        e.preventDefault();
        const scaleFactor = 1.1;
        const { clientX, clientY, deltaY } = e;
        const point = svgRef.current.createSVGPoint();
        point.x = clientX; point.y = clientY;
        const { x: mouseX, y: mouseY } = point.matrixTransform(svgRef.current.getScreenCTM().inverse());

        const newScale = deltaY < 0 ? transform.k * scaleFactor : transform.k / scaleFactor;
        const newX = mouseX - (mouseX - transform.x) * (newScale / transform.k);
        const newY = mouseY - (mouseY - transform.y) * (newScale / transform.k);
        setTransform({ x: newX, y: newY, k: newScale });
    };

    const handlePanStart = (e) => {
        if (isDragging) return;
        isPanning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY };
        svgRef.current.style.cursor = 'grabbing';
    };

    const handleEdgeClick = (edgeId) => { onSelect({ type: 'edge', id: edgeId }); setSimulationActive(false); };

    const getEdgeThickness = (similarity) => {
        const minThickness = 0.5, maxThickness = 8;
        const threshold = similarityThreshold / 100;
        const normalized = (similarity - threshold) / (1.0 - threshold);
        return minThickness + Math.pow(normalized, 3) * (maxThickness - minThickness);
    };

    // [FIX 1 of 2] - The useMemo for clusterHulls
    const clusterHulls = useMemo(() => {
        if (!clusters || Object.keys(nodePositions).length === 0) return [];
        // Map over clusters and get their original index
        return clusters.map((cluster, index) => {
            const points = cluster.map(nodeId => nodePositions[nodeId]).filter(Boolean);
            // We still only compute hulls for 3+ points
            if (points.length < 3) return null;
            const hull = computeConvexHull(points);
            // Return an object containing the hull AND its original index
            return { hull, originalIndex: index };
        }).filter(Boolean); // Filter out the nulls
    }, [clusters, nodePositions]);

    const handleClusterClick = (clusterIndex) => {
        const clusterNodeIds = clusters[clusterIndex];
        const points = clusterNodeIds.map(id => nodePositions[id]);
        if (points.length === 0 || !svgRef.current) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        points.forEach(p => {
            minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        });

        const { width, height } = svgRef.current.getBoundingClientRect();
        const padding = 50;
        const clusterWidth = maxX - minX;
        const clusterHeight = maxY - minY;

        const scaleX = width / (clusterWidth + padding * 2);
        const scaleY = height / (clusterHeight + padding * 2);
        const k = Math.min(scaleX, scaleY, 4); // Cap zoom at 4x

        const newX = (width / 2) - ((minX + clusterWidth / 2) * k);
        const newY = (height / 2) - ((minY + clusterHeight / 2) * k);

        setTransform({ x: newX, y: newY, k });
        setFocusedCluster({ index: clusterIndex });
    };

    return (
        <div className="w-full h-full bg-gray-800 rounded-lg shadow-inner overflow-hidden relative cursor-grab active:cursor-grabbing"
            onMouseDown={handlePanStart}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
        >
            {focusedCluster && <button onClick={() => {setFocusedCluster(null); setTransform({x:0,y:0,k:1});}} className="absolute top-2 left-2 z-10 bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded-md text-sm">Reset View</button>}
            <svg ref={svgRef} width="100%" height="100%">
                <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
                    {/* [FIX 2 of 2] - The render loop for clusterHulls */}
                    {/* Destructure the object to get hull and originalIndex */}
                    {!focusedCluster && clusterHulls.map(({ hull, originalIndex }) => (
                        <path
                            key={originalIndex} // Use originalIndex for key
                            d={`M ${hull.map(p => `${p.x} ${p.y}`).join(' L ')} Z`}
                            fill={`hsla(${(originalIndex * 50) % 360}, 90%, 50%, 0.1)`} // Use originalIndex for color
                            stroke={`hsla(${(originalIndex * 50) % 360}, 90%, 50%, 0.3)`} // Use originalIndex for color
                            strokeWidth={2 / transform.k}
                            className="cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); handleClusterClick(originalIndex); }} // Use originalIndex in click handler
                        />
                    ))}

                    {visibleProximityMatrix.map(({ source, target, similarity }) => {
                        const posA = nodePositions[source]; const posB = nodePositions[target];
                        if (!posA || !posB) return null;
                        const isSelected = selectedElement?.type === 'edge' && selectedElement.id === `${source}-${target}`;
                        const inPath = highlightedPath?.edges.has([source, target].sort().join('-'));
                        const thickness = getEdgeThickness(similarity);
                        let stroke = '#4b5563';
                        if(inPath) stroke = '#f59e0b';
                        if(isSelected) stroke = '#34d399';

                        return <line key={`${source}-${target}`} x1={posA.x} y1={posA.y} x2={posB.x} y2={posB.y} stroke={stroke} strokeWidth={isSelected || inPath ? (thickness + 2) / transform.k : thickness / transform.k} onClick={(e) => { e.stopPropagation(); handleEdgeClick(`${source}-${target}`)}} className="cursor-pointer transition-all duration-200"/>;
                    })}
                    {documents.filter(d => visibleNodes.has(d.id)).map(doc => {
                        const pos = nodePositions[doc.id];
                        if (!pos) return null;
                        const isSingleSelected = selectedElement?.type === 'node' && selectedElement.id === doc.id;
                        const isPathEndpoint = pathNodes.includes(doc.id);
                        const inPath = highlightedPath?.nodes.has(doc.id);

                        let fill = '#93c5fd', stroke = '#60a5fa';
                        const baseRadius = getNodeRadius(doc.id);
                        let r = baseRadius;
                        if(inPath) { fill = '#fde68a'; stroke = '#f59e0b'; }
                        if(isPathEndpoint) { fill = '#fbbf24'; stroke = '#d97706'; r = baseRadius + 2;}
                        if(isSingleSelected) { fill = '#60a5fa'; stroke = '#2563eb'; r = baseRadius + 4; }

                        return (
                            <g key={doc.id} transform={`translate(${pos.x}, ${pos.y})`}>
                                <circle r={r / transform.k} fill={fill} stroke={stroke} strokeWidth={2 / transform.k} onMouseDown={(e) => handleNodeMouseDown(e, doc.id)} className="cursor-grab active:cursor-grabbing transition-all duration-200" />
                                <text x="0" y={(r / transform.k) + 12 / transform.k} textAnchor="middle" fill="#e5e7eb" fontSize={10 / transform.k} className="pointer-events-none select-none">
                                    {doc.title.length > 25 ? doc.title.substring(0, 22) + '...' : doc.title}
                                </text>
                                <title>{doc.title}</title>
                            </g>
                        );
                    })}
                </g>
            </svg>
        </div>
    );
};

const AbstractViewer = ({ abstract }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    if (abstract === "Abstract not found.") return <p className="text-sm text-gray-400 italic mt-3">{abstract}</p>
    return (
        <div className="mt-3">
            <button onClick={() => setIsExpanded(!isExpanded)} className="text-sm text-blue-400 hover:underline">
                {isExpanded ? 'Hide' : 'Show'} Abstract
            </button>
            {isExpanded && <p className="text-sm text-gray-300 mt-2 bg-gray-700 p-3 rounded-md max-h-48 overflow-y-auto">{abstract}</p>}
        </div>
    )
}

/**
 * InfoPanel: Displays contextual information about selections.
 */
const InfoPanel = ({ selectedElement, documents, proximityMatrix }) => {
    let content = (
        <div className="text-center p-4">
            <FileTextIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-100">Information Panel</h3>
            <p className="mt-1 text-sm text-gray-400">Select an element in the graph to see details.</p>
        </div>
    );

    if (selectedElement?.type === 'node') {
        const doc = documents.find(d => d.id === selectedElement.id);
        if (doc) {
            content = (
                <div className="p-4">
                    <h3 className="font-bold text-lg text-blue-300 break-words">{doc.title}</h3>
                    <p className="text-sm text-gray-400 mt-2 mb-3 font-semibold">Top 5 Keywords:</p>
                    <div className="flex flex-wrap gap-2">
                        {doc.descriptors.map(desc => <span key={desc} className="px-2 py-1 bg-gray-600 text-gray-200 text-xs rounded-md">{desc}</span>)}
                    </div>
                    <AbstractViewer abstract={doc.abstract} />
                </div>
            );
        }
    } else if (selectedElement?.type === 'edge') {
        const edge = proximityMatrix.find(e => `${e.source}-${e.target}` === selectedElement.id || `${e.target}-${e.source}` === selectedElement.id);
        if (edge) {
            const docA = documents.find(d => d.id === edge.source);
            const docB = documents.find(d => d.id === edge.target);

            const getCommonTerms = (textA, textB) => {
                const wordsA = new Set((textA.toLowerCase().match(/\b\w+\b/g) || []).filter(w => w.length >= 4 && !ENGLISH_STOP_WORDS.has(w)));
                const wordsB = new Set((textB.toLowerCase().match(/\b\w+\b/g) || []).filter(w => w.length >= 4 && !ENGLISH_STOP_WORDS.has(w)));
                const commonWords = [...wordsA].filter(word => wordsB.has(word));
                const combinedText = textA + " " + textB;
                const wordCounts = new Map();
                (combinedText.toLowerCase().match(/\b\w+\b/g) || []).forEach(word => {
                    if (commonWords.includes(word)) {
                        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
                    }
                });
                return Array.from(wordCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(entry => entry[0]);
            };

            const commonTerms = getCommonTerms(docA.fullText, docB.fullText);

            content = (
                 <div className="p-4">
                    <h3 className="font-bold text-lg text-emerald-300">Similarity: {(edge.similarity * 100).toFixed(2)}%</h3>
                     <div className="mt-4 space-y-3">
                         <p className="text-sm text-gray-300 break-words"><span className="font-semibold text-gray-400">Doc A:</span> {docA.title}</p>
                         <p className="text-sm text-gray-300 break-words"><span className="font-semibold text-gray-400">Doc B:</span> {docB.title}</p>
                     </div>
                     <div className="mt-4">
                        <h4 className="font-semibold text-gray-400 mb-2">Termini Semantici Comuni</h4>
                        <p className="text-xs text-gray-500 mb-3">I concetti più rilevanti condivisi tra i due documenti:</p>
                        {commonTerms.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {commonTerms.map(term => (
                                    <span key={term} className="px-2 py-1 bg-gray-700 text-gray-200 text-xs rounded-md">{term}</span>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-400 italic">Nessun termine comune significativo trovato.</p>
                        )}
                    </div>
                </div>
            );
        }
    }

    return <div className="bg-gray-800 rounded-lg h-full overflow-y-auto">{content}</div>;
};

/**
 * DocumentList: Displays the list of processed documents.
 */
const DocumentList = ({ documents, pathNodes, onTogglePathNode, onDeselectAll }) => {
    return (
        <div className="bg-gray-800 rounded-lg p-4 h-full flex flex-col min-h-0">
            <div className="flex justify-between items-center mb-4 flex-shrink-0">
                 <h3 className="text-lg font-bold text-gray-200">Document List</h3>
                 {pathNodes.length > 0 && (
                    <button
                        onClick={onDeselectAll}
                        className="text-xs text-blue-400 hover:underline"
                    >
                        Deselect All
                    </button>
                 )}
            </div>
            <div className="overflow-y-auto flex-grow pr-2">
                {documents.length === 0 ? (
                    <p className="text-sm text-gray-400">Upload documents to begin.</p>
                ) : (
                    <ul className="space-y-2">
                        {documents.map(doc => (
                            <li key={doc.id}>
                                <button
                                    onClick={() => onTogglePathNode(doc.id)}
                                    className={`w-full text-left p-2 rounded-md text-sm transition-colors ${pathNodes.includes(doc.id) ? 'bg-amber-600 text-white' : 'hover:bg-gray-700 text-gray-300'}`}
                                >
                                    {doc.title}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};


// --- 4. Main App Component ---

function App() {
    const [isPdfJsReady, setIsPdfJsReady] = useState(false);
    const [pipelineStatus, setPipelineStatus] = useState({ready: false, message: 'Initializing AI model...'});
    const [files, setFiles] = useState([]);
    const [documents, setDocuments] = useState([]);
    const [processingState, setProcessingState] = useState({ isLoading: false, progress: 0, message: '' });
    const [selectedElement, setSelectedElement] = useState(null);
    const [pathNodes, setPathNodes] = useState([]);
    const [highlightedPath, setHighlightedPath] = useState(null);
    const [infoMessage, setInfoMessage] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);
    const [similarityThreshold, setSimilarityThreshold] = useState(70);
    const [clusters, setClusters] = useState([]);
    const [focusedCluster, setFocusedCluster] = useState(null);
    const fileInputRef = useRef(null);

    useEffect(() => {
        let checkCount = 0;
        const checkPdfJs = setInterval(() => {
            checkCount++;
            if (window.pdfjsLib) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${window.pdfjsLib.version}/pdf.worker.min.js`;
                setIsPdfJsReady(true);
                clearInterval(checkPdfJs);
            } else if (checkCount > 50) {
                 clearInterval(checkPdfJs);
                 setErrorMessage("Failed to load the PDF processing library. Please check your internet connection and refresh the page.");
            }
        }, 200);
        return () => clearInterval(checkPdfJs);
    }, []);

    // Initialize the AI pipeline
    useEffect(() => {
        setPipelineStatus({ready: false, message: 'Loading AI model...'});
        PipelineSingleton.getInstance(progress => {
            const percent = (progress.progress || 0).toFixed(2);
            setPipelineStatus({ready: false, message: `Downloading model... ${percent}%`});
        }).then(() => {
            setPipelineStatus({ready: true, message: 'AI Model Ready'});
        }).catch(err => {
            setErrorMessage("Failed to load AI model. Please refresh the page.");
            console.error(err);
        });
    }, []);

    const handleFileChange = (event) => {
        const newFiles = Array.from(event.target.files);
        setFiles(prevFiles => {
            const existingFileNames = new Set(prevFiles.map(f => f.name));
            const uniqueNewFiles = newFiles.filter(f => !existingFileNames.has(f.name));
            return [...prevFiles, ...uniqueNewFiles];
        });
    };

    const performAnalysis = useCallback(async () => {
        if (files.length === 0 || !pipelineStatus.ready) return;
        setErrorMessage(null);
        setInfoMessage(null);
        setProcessingState({ isLoading: true, progress: 0, message: 'Initializing...' });
        setDocuments([]);
        setSelectedElement(null);
        setPathNodes([]);

        const docData = [];
        const contentHashes = new Set();
        const skippedFiles = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setProcessingState(prev => ({ ...prev, progress: ((i + 1) / files.length) * 40, message: `Reading ${file.name}...` }));

            try {
                const fileReader = new FileReader();
                const fileBuffer = await new Promise((resolve, reject) => {
                    fileReader.onload = (e) => resolve(e.target.result);
                    fileReader.onerror = (e) => reject(new Error("File reading error"));
                    fileReader.readAsArrayBuffer(file);
                });

                const pdf = await window.pdfjsLib.getDocument({ data: fileBuffer }).promise;
                let fullText = '';
                for (let j = 1; j <= pdf.numPages; j++) {
                    const page = await pdf.getPage(j);
                    const textContent = await page.getTextContent();
                    fullText += textContent.items.map(item => item.str).join(' ') + ' ';
                }

                const contentText = removeBibliography(fullText);
                const textHash = createSimpleHash(contentText);

                if (contentHashes.has(textHash)) {
                    skippedFiles.push(file.name);
                    continue;
                }
                contentHashes.add(textHash);

                docData.push({
                    id: file.name,
                    title: file.name,
                    fullText: contentText,
                    abstract: extractAbstract(fullText)
                });
            } catch (error) {
                console.error(`Failed to process ${file.name}:`, error);
                setErrorMessage(`Errore durante l'elaborazione di "${file.name}". Il file potrebbe essere protetto da password, corrotto o in un formato non supportato.`);
                setProcessingState({ isLoading: false, progress: 0, message: 'Analysis failed.' });
                return;
            }
        }

        if (docData.length > 0) {
            try {
                setProcessingState({ isLoading: true, progress: 50, message: 'Generating semantic vectors...' });
                const textsToEmbed = docData.map(doc => doc.fullText);

                const extractor = await PipelineSingleton.getInstance();
                const embeddings = await extractor(textsToEmbed, { pooling: 'mean', normalize: true });
                const semanticVectors = embeddings.tolist();

                if (semanticVectors.length !== docData.length) {
                    throw new Error("Mismatch between documents and returned vectors.");
                }

                const finalProcessedDocs = docData.map((doc, i) => {
                    return {
                        ...doc,
                        vector: semanticVectors[i],
                        descriptors: extractDescriptorsFromText(doc.fullText)
                    };
                });

                setDocuments(finalProcessedDocs);

            } catch (apiError) {
                setErrorMessage(`AI Model Error: ${apiError.message}.`);
                setProcessingState({ isLoading: false, progress: 0, message: '' });
                return;
            }
        }

        setProcessingState({ isLoading: false, progress: 100, message: 'Analysis Complete!' });

        if (skippedFiles.length > 0) {
            setErrorMessage(`I seguenti file sono stati ignorati perché duplicati: ${skippedFiles.join(', ')}`);
        }

    }, [files, pipelineStatus.ready]);

    const proximityMatrix = useMemo(() => {
        if (documents.length < 2) return [];
        const threshold = similarityThreshold / 100;
        const matrix = [];
        for (let i = 0; i < documents.length; i++) {
            for (let j = i + 1; j < documents.length; j++) {
                const docA = documents[i];
                const docB = documents[j];
                const similarity = cosineSimilarity(docA.vector, docB.vector);
                if (similarity > threshold) {
                    matrix.push({ source: docA.id, target: docB.id, similarity });
                }
            }
        }
        return matrix;
    }, [documents, similarityThreshold]);

    const handleTogglePathNode = (nodeId) => {
        setPathNodes(prev => {
            const newSelection = new Set(prev);
            if (newSelection.has(nodeId)) newSelection.delete(nodeId);
            else newSelection.add(nodeId);
            return Array.from(newSelection);
        });
    };

    const handleDeselectAll = () => {
        setPathNodes([]);
    };

    useEffect(() => {
        setHighlightedPath(null);
        setInfoMessage(null);
        if (pathNodes.length < 2) return;

        const adj = new Map();
        documents.forEach(doc => adj.set(doc.id, []));
        proximityMatrix.forEach(({ source, target }) => {
            adj.get(source).push(target);
            adj.get(target).push(source);
        });

        const allPairsPaths = new Map();
        for (let i = 0; i < pathNodes.length; i++) {
            for (let j = i + 1; j < pathNodes.length; j++) {
                const path = findShortestPath(pathNodes[i], pathNodes[j], adj);
                if (path) {
                    allPairsPaths.set([pathNodes[i], pathNodes[j]].sort().join('-'), path);
                }
            }
        }

        if (pathNodes.length > 2) {
             const mstEdges = [];
             const visited = new Set([pathNodes[0]]);
             const edges = [];
             pathNodes.forEach(u => {
                 pathNodes.forEach(v => {
                     if (u < v) {
                         const path = allPairsPaths.get([u, v].sort().join('-'));
                         if(path) edges.push({ u, v, weight: path.length - 1 });
                     }
                 });
             });
             edges.sort((a,b) => a.weight - b.weight);

             for(const edge of edges) {
                 if(!visited.has(edge.v)) {
                     mstEdges.push(edge);
                     visited.add(edge.v);
                 }
             }

            let finalNodes = new Set();
            let finalEdges = new Set();
            mstEdges.forEach(edge => {
                const path = allPairsPaths.get([edge.u, edge.v].sort().join('-'));
                path.forEach(node => finalNodes.add(node));
                for(let i=0; i < path.length - 1; i++) {
                    finalEdges.add([path[i], path[i+1]].sort().join('-'));
                }
            });
            setHighlightedPath({ nodes: finalNodes, edges: finalEdges });

        } else if (pathNodes.length === 2) {
            const path = allPairsPaths.get([pathNodes[0], pathNodes[1]].sort().join('-'));
            if (path) {
                 let finalEdges = new Set();
                 for(let i=0; i < path.length - 1; i++) {
                    finalEdges.add([path[i], path[i+1]].sort().join('-'));
                }
                setHighlightedPath({ nodes: new Set(path), edges: finalEdges });
            } else {
                 const doc1 = documents.find(d => d.id === pathNodes[0]);
                 const doc2 = documents.find(d => d.id === pathNodes[1]);
                 if (doc1 && doc2) setInfoMessage(`Non è possibile connettere "${doc1.title}" e "${doc2.title}".`);
            }
        }
    }, [pathNodes, documents, proximityMatrix]);

    // [FIX] - Changed cluster generation logic
    useEffect(() => {
        if(documents.length > 0) {
            const components = findConnectedComponents(documents, proximityMatrix);
            // Only set clusters if they have 3 or more nodes
            setClusters(components.filter(c => c.length >= 3));
        } else {
            setClusters([]);
        }
    }, [documents, proximityMatrix]);

    const handleDownloadCSV = () => {
        if (documents.length === 0) return;
        const headers = ['Title', 'Descriptor_1', 'Descriptor_2', 'Descriptor_3', 'Descriptor_4', 'Descriptor_5'];
        const rows = documents.map(doc => {
            const descriptors = doc.descriptors.concat(Array(5 - doc.descriptors.length).fill(''));
            const sanitizedTitle = `"${doc.title.replace(/"/g, '""')}"`;
            return [sanitizedTitle, ...descriptors].join(',');
        });
        const csvContent = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'document_analysis.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const uploadButtonText = errorMessage ? 'Error' : isPdfJsReady ? 'Upload PDFs' : 'Initializing...';
    const analyzeButtonDisabled = files.length === 0 || processingState.isLoading || !pipelineStatus.ready;

    return (
        <div className="bg-gray-900 text-gray-100 font-sans w-full h-screen flex flex-col p-4 gap-4 relative">
            <style>{`.animate-fade-in-up { animation: fade-in-up 0.3s ease-out forwards; } @keyframes fade-in-up { from { opacity: 0; transform: translateY(-20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
            <AlertMessage message={errorMessage} onDismiss={() => setErrorMessage(null)} type="error"/>
            <AlertMessage message={infoMessage} onDismiss={() => setInfoMessage(null)} type="info"/>

            <header className="flex-shrink-0 flex items-center justify-between bg-gray-800 p-4 rounded-lg shadow-md">
                <div className="flex items-center gap-3"><FileTextIcon className="h-8 w-8 text-blue-400"/><h1 className="text-xl font-bold tracking-tight">PDF Document Similarity Analyzer</h1></div>

                <div className="flex items-center gap-4">
                     <div className="flex items-center gap-3">
                        <label htmlFor="threshold" className="text-sm font-medium text-gray-300">Threshold: {similarityThreshold}%</label>
                        <input
                            id="threshold"
                            type="range"
                            min="1"
                            max="99"
                            value={similarityThreshold}
                            onChange={(e) => setSimilarityThreshold(Number(e.target.value))}
                            disabled={documents.length === 0}
                            className="w-32 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => fileInputRef.current.click()} disabled={!isPdfJsReady || processingState.isLoading || !!errorMessage} className={`px-4 py-2 text-white rounded-md flex items-center gap-2 transition-colors ${errorMessage ? 'bg-red-700 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed'}`}>
                             {!isPdfJsReady && !errorMessage ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div> : errorMessage ? <AlertTriangleIcon className="h-5 w-5" /> : <UploadCloudIcon className="h-5 w-5" />}
                            <span>{uploadButtonText}</span>
                        </button>
                        <input type="file" multiple accept=".pdf" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                        <button onClick={performAnalysis} disabled={analyzeButtonDisabled} className="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors">
                            {pipelineStatus.ready ? `Analyze Documents (${files.length})` : 'Loading AI...'}
                        </button>
                        <button onClick={handleDownloadCSV} disabled={documents.length === 0 || processingState.isLoading} className="px-4 py-2 bg-gray-600 text-white rounded-md flex items-center gap-2 hover:bg-gray-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors"><DownloadIcon className="h-5 w-5"/>Download CSV</button>
                    </div>
                </div>
            </header>

            <main className="flex-grow grid grid-cols-5 gap-4 min-h-0">
                <aside className="col-span-1 min-h-0">
                    <DocumentList documents={documents} pathNodes={pathNodes} onTogglePathNode={handleTogglePathNode} onDeselectAll={handleDeselectAll} />
                </aside>
                <section className="col-span-3 flex flex-col gap-2">
                    <div className="h-4 text-xs text-center text-gray-400">
                        {processingState.isLoading ? (
                            <div className="w-full bg-gray-700 rounded-full h-2.5 "><div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${processingState.progress}%` }}></div></div>
                        ) : (
                            <p>{!pipelineStatus.ready ? pipelineStatus.message : "Ready for analysis."}</p>
                        )}
                         <p>{processingState.isLoading ? processingState.message : ""}</p>
                    </div>
                    <GraphViewer documents={documents} proximityMatrix={proximityMatrix} onSelect={setSelectedElement} selectedElement={selectedElement} pathNodes={pathNodes} highlightedPath={highlightedPath} similarityThreshold={similarityThreshold} clusters={clusters} focusedCluster={focusedCluster} setFocusedCluster={setFocusedCluster}/>
                </section>
                <aside className="col-span-1 min-h-0">
                    <InfoPanel selectedElement={selectedElement} documents={documents} proximityMatrix={proximityMatrix}/>
                </aside>
            </main>
        </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);