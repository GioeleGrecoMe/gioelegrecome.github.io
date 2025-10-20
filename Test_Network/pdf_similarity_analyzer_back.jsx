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


// --- 2. Helper Functions ---

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

/**
 * Tries to heuristically extract the article title from the first page's text.
 * @param {object} pdfDocument - The PDF document object from pdf.js.
 * @returns {Promise<string|null>} - The extracted title or null if not found.
 */
const extractTitleFromFirstPage = async (pdfDocument) => {
    try {
        const page = await pdfDocument.getPage(1);
        const textContent = await page.getTextContent();

        const lines = [];
        let currentLine = [];
        let lastY = -1;

        textContent.items.forEach(item => {
            if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 5) { // Threshold for new line
                lines.push({text: currentLine.join(' '), height: item.height});
                currentLine = [];
            }
            currentLine.push(item.str);
            lastY = item.transform[5];
        });
        lines.push({text: currentLine.join(' '), height: textContent.items[textContent.items.length-1]?.height || 10});

        const potentialTitleLines = lines.slice(0, 20)
            .map(line => ({ ...line, text: line.text.trim().replace(/\s+/g, ' ') }))
            .filter(line => line.text.length > 15 && line.text.length < 150 && !/^\d+$/.test(line.text) && isNaN(Date.parse(line.text)));

        if (potentialTitleLines.length === 0) return null;

        // Find the line with the largest font size (height)
        const title = potentialTitleLines.reduce((a, b) => a.height > b.height ? a : b);

        return title.text;
    } catch (error) {
        console.error("Error extracting title from first page:", error);
        return null;
    }
};

/**
 * Attempts to remove the bibliography section from a text based on common headers.
 * @param {string} text - The full text content.
 * @returns {string} - Text with the bibliography section removed, if found.
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
 * @param {string} text - The full text content.
 * @returns {string[]} - An array of the top 5 keywords.
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
 * @param {string} text - The input string.
 * @returns {number} - A numerical hash.
 */
const createSimpleHash = (text) => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
};

/**
 * Creates a deterministic 3D numerical vector from text content using a simple hashing algorithm.
 * @param {string} text - The full text content.
 * @returns {number[]} - A 3D vector [x, y, z].
 */
const createVectorFromText = (text) => {
    let hash1 = 0, hash2 = 0, hash3 = 0;
    if (!text) return [0, 0, 0];

    for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        hash1 = (hash1 << 5) - hash1 + charCode;
        hash1 |= 0;
        hash2 = (hash2 << 4) - hash2 + charCode;
        hash2 |= 0;
        hash3 = (hash3 << 6) - hash3 + charCode;
        hash3 |= 0;
    }

    const magnitude = Math.sqrt(hash1 * hash1 + hash2 * hash2 + hash3 * hash3);
    if (magnitude === 0) return [0, 0, 0];

    return [hash1 / magnitude, hash2 / magnitude, hash3 / magnitude];
};


/**
 * Calculates the Cosine Similarity between two vectors.
 * @param {number[]} vecA - The first vector.
 * @param {number[]} vecB - The second vector.
 * @returns {number} - The cosine similarity score (0 to 1).
 */
const cosineSimilarity = (vecA, vecB) => {
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
};


// --- 3. UI Components ---

/**
 * ErrorMessage: Displays a modal overlay for critical errors.
 */
const ErrorMessage = ({ message, onDismiss }) => {
    if (!message) return null;
    return (
        <div className="absolute top-0 left-0 w-full h-full bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" role="alertdialog" aria-modal="true" aria-labelledby="error-heading">
            <div className="bg-red-900 border border-red-700 text-white p-6 rounded-lg shadow-2xl max-w-md w-full text-center transform transition-all scale-95 opacity-0 animate-fade-in-up">
                <AlertTriangleIcon className="mx-auto h-12 w-12 text-red-400 mb-4"/>
                <h3 id="error-heading" className="text-xl font-bold text-red-200 mb-2">An Error Occurred</h3>
                <p className="text-red-200 mb-6">{message}</p>
                <button
                    onClick={onDismiss}
                    className="px-6 py-2 bg-red-600 text-white font-semibold hover:bg-red-700 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-red-900 focus:ring-red-500"
                >
                    Dismiss
                </button>
            </div>
        </div>
    );
};


/**
 * GraphViewer: Renders and manages the interactive force-directed graph.
 */
const GraphViewer = ({ documents, proximityMatrix, onSelect, selectedElement }) => {
    const svgRef = useRef(null);
    const [nodePositions, setNodePositions] = useState({});
    const [isDragging, setIsDragging] = useState(null);
    const animationFrameRef = useRef();
    const [simulationActive, setSimulationActive] = useState(true);
    const energyRef = useRef(0);
    const dragInfo = useRef(null);

    useEffect(() => {
        if (!svgRef.current) return;
        const { width, height } = svgRef.current.getBoundingClientRect();

        const initialPositions = {};
        documents.forEach(doc => {
            initialPositions[doc.id] = {
                x: width / 2 + (Math.random() - 0.5) * 100,
                y: height / 2 + (Math.random() - 0.5) * 100,
                vx: 0,
                vy: 0,
            };
        });
        setNodePositions(initialPositions);
        setSimulationActive(true);
    }, [documents]);

    useEffect(() => {
        if (!simulationActive) {
            return;
        }

        const { width, height } = svgRef.current.getBoundingClientRect();

        const REPULSION_STRENGTH = 1500;
        const ATTRACTION_STRENGTH = 0.05;
        const IDEAL_DISTANCE = 150;
        const DAMPING = 0.95;
        const STABILITY_THRESHOLD = 0.005;

        const simulationStep = () => {
            setNodePositions(currentPositions => {
                if (Object.keys(currentPositions).length !== documents.length) {
                    return currentPositions;
                }

                const newPositions = JSON.parse(JSON.stringify(currentPositions));
                let totalKineticEnergy = 0;

                documents.forEach(docA => {
                    newPositions[docA.id].vx *= DAMPING;
                    newPositions[docA.id].vy *= DAMPING;

                    documents.forEach(docB => {
                        if (docA.id === docB.id) return;
                        const posA = newPositions[docA.id];
                        const posB = newPositions[docB.id];
                        const dx = posA.x - posB.x;
                        const dy = posA.y - posB.y;
                        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                        const force = REPULSION_STRENGTH / (distance * distance);

                        posA.vx += (dx / distance) * force;
                        posA.vy += (dy / distance) * force;
                    });
                });

                proximityMatrix.forEach(edge => {
                    const posA = newPositions[edge.source];
                    const posB = newPositions[edge.target];
                    if (!posA || !posB) return;

                    const dx = posB.x - posA.x;
                    const dy = posB.y - posA.y;
                    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                    const displacement = distance - IDEAL_DISTANCE;
                    const force = ATTRACTION_STRENGTH * displacement;

                    const forceX = (dx / distance) * force;
                    const forceY = (dy / distance) * force;

                    posA.vx += forceX;
                    posA.vy += forceY;
                    posB.vx -= forceX;
                    posB.vy -= forceY;
                });

                documents.forEach(doc => {
                    if (isDragging && isDragging.id === doc.id) {
                         newPositions[doc.id].vx = 0;
                         newPositions[doc.id].vy = 0;
                    } else {
                        const pos = newPositions[doc.id];
                        pos.x += pos.vx;
                        pos.y += pos.vy;

                        pos.x = Math.max(15, Math.min(width - 15, pos.x));
                        pos.y = Math.max(15, Math.min(height - 15, pos.y));
                    }
                    totalKineticEnergy += (newPositions[doc.id].vx ** 2) + (newPositions[doc.id].vy ** 2);
                });

                energyRef.current = totalKineticEnergy;
                return newPositions;
            });

            if (energyRef.current < STABILITY_THRESHOLD && !isDragging) {
                setSimulationActive(false);
            } else {
                animationFrameRef.current = requestAnimationFrame(simulationStep);
            }
        };

        animationFrameRef.current = requestAnimationFrame(simulationStep);
        return () => cancelAnimationFrame(animationFrameRef.current);
    }, [simulationActive, documents, proximityMatrix, isDragging]);

    const handleNodeMouseDown = (e, docId) => {
        e.preventDefault();
        dragInfo.current = { startX: e.clientX, startY: e.clientY, moved: false };

        const { clientX, clientY } = e;
        const svgPoint = svgRef.current.createSVGPoint();
        svgPoint.x = clientX;
        svgPoint.y = clientY;
        const { x, y } = svgPoint.matrixTransform(svgRef.current.getScreenCTM().inverse());

        setIsDragging({ id: docId, offsetX: x - nodePositions[docId].x, offsetY: y - nodePositions[docId].y });
        onSelect({ type: 'node', id: docId });
    };

    const handleMouseMove = (e) => {
        if (!isDragging) return;

        if (dragInfo.current && !dragInfo.current.moved) {
            const dx = e.clientX - dragInfo.current.startX;
            const dy = e.clientY - dragInfo.current.startY;
            if (Math.sqrt(dx * dx + dy * dy) > 5) {
                dragInfo.current.moved = true;
                setSimulationActive(true);
            }
        }

        if (dragInfo.current && dragInfo.current.moved) {
            const { clientX, clientY } = e;
            const svgPoint = svgRef.current.createSVGPoint();
            svgPoint.x = clientX;
            svgPoint.y = clientY;
            const { x, y } = svgPoint.matrixTransform(svgRef.current.getScreenCTM().inverse());

            setNodePositions(prev => ({
                ...prev,
                [isDragging.id]: { ...prev[isDragging.id], x: x - isDragging.offsetX, y: y - isDragging.offsetY }
            }));
        }
    };

    const handleMouseUp = () => {
        if (isDragging && dragInfo.current && !dragInfo.current.moved) {
            setSimulationActive(false);
        }
        setIsDragging(null);
        dragInfo.current = null;
    };

    const handleEdgeClick = (edgeId) => {
        onSelect({ type: 'edge', id: edgeId });
        setSimulationActive(false);
    };

    const getEdgeThickness = (similarity) => {
        const minSimilarity = 0.7;
        const maxSimilarity = 1.0;
        const minThickness = 0.5;
        const maxThickness = 8;

        if (similarity <= minSimilarity) return minThickness;

        const normalized = (similarity - minSimilarity) / (maxSimilarity - minSimilarity);
        // Use a power function (e.g., cubic) to make the growth exponential
        const scaledThickness = minThickness + Math.pow(normalized, 3) * (maxThickness - minThickness);
        return scaledThickness;
    };


    return (
        <div className="w-full h-full bg-gray-800 rounded-lg shadow-inner overflow-hidden">
            <svg ref={svgRef} width="100%" height="100%" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
                {proximityMatrix.map(({ source, target, similarity }) => {
                    const posA = nodePositions[source];
                    const posB = nodePositions[target];
                    if (!posA || !posB) return null;
                    const isSelected = selectedElement?.type === 'edge' && selectedElement.id === `${source}-${target}`;
                    const thickness = getEdgeThickness(similarity);

                    return <line key={`${source}-${target}`} x1={posA.x} y1={posA.y} x2={posB.x} y2={posB.y} stroke={isSelected ? "#34d399" : "#4b5563"} strokeWidth={isSelected ? thickness + 2 : thickness} onClick={() => handleEdgeClick(`${source}-${target}`)} className="cursor-pointer transition-all duration-200"/>;
                })}
                {documents.map(doc => {
                    const pos = nodePositions[doc.id];
                    if (!pos) return null;
                    const isSelected = selectedElement?.type === 'node' && selectedElement.id === doc.id;

                    return (
                        <g key={doc.id} transform={`translate(${pos.x}, ${pos.y})`}>
                            <circle
                                r={isSelected ? 14 : 10}
                                fill={isSelected ? "#60a5fa" : "#93c5fd"}
                                stroke={isSelected ? "#2563eb" : "#60a5fa"}
                                strokeWidth="2"
                                onMouseDown={(e) => handleNodeMouseDown(e, doc.id)}
                                className="cursor-grab active:cursor-grabbing transition-all duration-200"
                            />
                            <text
                                x="0"
                                y={isSelected ? 26 : 22}
                                textAnchor="middle"
                                fill="#e5e7eb"
                                fontSize="10px"
                                className="pointer-events-none select-none"
                            >
                                {doc.title.length > 25 ? doc.title.substring(0, 22) + '...' : doc.title}
                            </text>
                            <title>{doc.title}</title>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};

/**
 * InfoPanel: Displays contextual information about selections.
 */
const InfoPanel = ({ selectedElement, documents, proximityMatrix }) => {
    let content = (
        <div className="text-center p-4">
            <FileTextIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-100">Information Panel</h3>
            <p className="mt-1 text-sm text-gray-400">Select a document or a connection to see details.</p>
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
                        {doc.descriptors.map(desc => (
                            <span key={desc} className="px-2 py-1 bg-gray-600 text-gray-200 text-xs rounded-md">{desc}</span>
                        ))}
                    </div>
                </div>
            );
        }
    } else if (selectedElement?.type === 'edge') {
        const edge = proximityMatrix.find(e => `${e.source}-${e.target}` === selectedElement.id || `${e.target}-${e.source}` === selectedElement.id);
        if (edge) {
            const docA = documents.find(d => d.id === edge.source);
            const docB = documents.find(d => d.id === edge.target);
            content = (
                 <div className="p-4">
                    <h3 className="font-bold text-lg text-emerald-300">Similarity: {(edge.similarity * 100).toFixed(2)}%</h3>
                     <div className="mt-4 space-y-3">
                         <p className="text-sm text-gray-300 break-words"><span className="font-semibold text-gray-400">Doc A:</span> {docA.title}</p>
                         <p className="text-sm text-gray-300 break-words"><span className="font-semibold text-gray-400">Doc B:</span> {docB.title}</p>
                     </div>
                </div>
            );
        }
    }

    return <div className="bg-gray-800 rounded-lg h-full flex items-center justify-center">{content}</div>;
};

/**
 * DocumentList: Displays the list of processed documents.
 */
const DocumentList = ({ documents, selectedElement, onSelect }) => {
    return (
        <div className="bg-gray-800 rounded-lg p-4 h-full flex flex-col">
            <h3 className="text-lg font-bold mb-4 text-gray-200 flex-shrink-0">Document List</h3>
            <div className="overflow-y-auto flex-grow">
                {documents.length === 0 ? (
                    <p className="text-sm text-gray-400">Upload documents to begin.</p>
                ) : (
                    <ul className="space-y-2">
                        {documents.map(doc => (
                            <li key={doc.id}>
                                <button
                                    onClick={() => onSelect({ type: 'node', id: doc.id })}
                                    className={`w-full text-left p-2 rounded-md text-sm transition-colors ${selectedElement?.id === doc.id ? 'bg-blue-600 text-white' : 'hover:bg-gray-700 text-gray-300'}`}
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
    const [files, setFiles] = useState([]);
    const [documents, setDocuments] = useState([]);
    const [proximityMatrix, setProximityMatrix] = useState([]);
    const [processingState, setProcessingState] = useState({ isLoading: false, progress: 0, message: '' });
    const [selectedElement, setSelectedElement] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);
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

    const handleFileChange = (event) => {
        const newFiles = Array.from(event.target.files);
        setFiles(prevFiles => {
            const existingFileNames = new Set(prevFiles.map(f => f.name));
            const uniqueNewFiles = newFiles.filter(f => !existingFileNames.has(f.name));
            return [...prevFiles, ...uniqueNewFiles];
        });
    };

    const performAnalysis = useCallback(async () => {
        if (files.length === 0) return;
        setErrorMessage(null);
        setProcessingState({ isLoading: true, progress: 0, message: 'Initializing...' });
        setDocuments([]);
        setProximityMatrix([]);
        setSelectedElement(null);

        const processedDocs = [];
        const contentHashes = new Set();

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setProcessingState(prev => ({ ...prev, progress: ((i + 1) / files.length) * 100, message: `Processing ${file.name}...` }));

            try {
                const fileReader = new FileReader();
                const fileBuffer = await new Promise((resolve) => {
                    fileReader.onload = (e) => resolve(e.target.result);
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
                    console.log(`Skipping duplicate document: ${file.name}`);
                    continue;
                }
                contentHashes.add(textHash);

                const metadata = await pdf.getMetadata();
                const heuristicTitle = await extractTitleFromFirstPage(pdf);
                const title = (metadata.info?.Title && metadata.info.Title.length > 5) ? metadata.info.Title : heuristicTitle || file.name;

                processedDocs.push({
                    id: file.name,
                    title,
                    fullText: contentText,
                    descriptors: extractDescriptorsFromText(contentText),
                    vector: createVectorFromText(contentText)
                });
            } catch (error) {
                console.error(`Failed to process ${file.name}:`, error);
                setErrorMessage(`Error processing "${file.name}". The file may be password-protected, corrupted, or in an unsupported format.`);
                setProcessingState({ isLoading: false, progress: 0, message: 'Analysis failed.' });
                return;
            }
        }

        setDocuments(processedDocs);

        const matrix = [];
        for (let i = 0; i < processedDocs.length; i++) {
            for (let j = i + 1; j < processedDocs.length; j++) {
                const docA = processedDocs[i]; const docB = processedDocs[j];
                const similarity = cosineSimilarity(docA.vector, docB.vector);
                if (similarity > 0.7) matrix.push({ source: docA.id, target: docB.id, similarity });
            }
        }

        setProximityMatrix(matrix);
        setProcessingState({ isLoading: false, progress: 100, message: 'Analysis Complete!' });
    }, [files]);

    const handleDownloadCSV = () => {
        if (documents.length === 0) return;

        const headers = ['Title', 'Vector_X', 'Vector_Y', 'Vector_Z', 'Descriptor_1', 'Descriptor_2', 'Descriptor_3', 'Descriptor_4', 'Descriptor_5'];
        const rows = documents.map(doc => {
            const vector = doc.vector.map(v => v.toFixed(6));
            const descriptors = doc.descriptors.concat(Array(5 - doc.descriptors.length).fill(''));
            const sanitizedTitle = `"${doc.title.replace(/"/g, '""')}"`;
            return [sanitizedTitle, ...vector, ...descriptors].join(',');
        });

        const csvContent = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'document_analysis.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const uploadButtonText = errorMessage ? 'Error' : isPdfJsReady ? 'Upload PDFs' : 'Initializing...';

    return (
        <div className="bg-gray-900 text-gray-100 font-sans w-full h-screen flex flex-col p-4 gap-4 relative">
            <style>{`.animate-fade-in-up { animation: fade-in-up 0.3s ease-out forwards; } @keyframes fade-in-up { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
            <ErrorMessage message={errorMessage} onDismiss={() => setErrorMessage(null)} />

            <header className="flex-shrink-0 flex items-center justify-between bg-gray-800 p-4 rounded-lg shadow-md">
                <div className="flex items-center gap-3"><FileTextIcon className="h-8 w-8 text-blue-400"/><h1 className="text-xl font-bold tracking-tight">PDF Document Similarity Analyzer</h1></div>
                <div className="flex items-center gap-2">
                    <button onClick={() => fileInputRef.current.click()} disabled={!isPdfJsReady || processingState.isLoading || !!errorMessage} className={`px-4 py-2 text-white rounded-md flex items-center gap-2 transition-colors ${errorMessage ? 'bg-red-700 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed'}`}>
                         {!isPdfJsReady && !errorMessage ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div> : errorMessage ? <AlertTriangleIcon className="h-5 w-5" /> : <UploadCloudIcon className="h-5 w-5" />}
                        <span>{uploadButtonText}</span>
                    </button>
                    <input type="file" multiple accept=".pdf" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                    <button onClick={performAnalysis} disabled={files.length === 0 || processingState.isLoading} className="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors">Analyze Documents ({files.length})</button>
                    <button onClick={handleDownloadCSV} disabled={documents.length === 0 || processingState.isLoading} className="px-4 py-2 bg-gray-600 text-white rounded-md flex items-center gap-2 hover:bg-gray-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors"><DownloadIcon className="h-5 w-5"/>Download CSV</button>
                </div>
            </header>

            <main className="flex-grow grid grid-cols-5 gap-4 min-h-0">
                <aside className="col-span-1">
                    <DocumentList documents={documents} selectedElement={selectedElement} onSelect={setSelectedElement} />
                </aside>
                <section className="col-span-3 flex flex-col gap-2">
                    {processingState.isLoading && <div className="w-full bg-gray-700 rounded-full h-2.5 mb-2"><div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${processingState.progress}%` }}></div></div>}
                     <p className="text-xs text-center text-gray-400 h-4">{processingState.isLoading ? processingState.message : documents.length > 0 ? "Analysis complete. Interact with the graph." : "Ready for analysis."}</p>
                    <GraphViewer documents={documents} proximityMatrix={proximityMatrix} onSelect={setSelectedElement} selectedElement={selectedElement} />
                </section>
                <aside className="col-span-1">
                    <InfoPanel selectedElement={selectedElement} documents={documents} proximityMatrix={proximityMatrix}/>
                </aside>
            </main>
        </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

