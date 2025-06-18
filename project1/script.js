        // Set current year in footer
        if (document.getElementById('year')) {
            document.getElementById('year').textContent = new Date().getFullYear();
        }

        // Canvas setup
        const canvas = document.getElementById('networkCanvas');
        const ctx = canvas.getContext('2d');
        const resetBtn = document.getElementById('resetBtn');
        const addAgentBtn = document.getElementById('addAgentBtn');
        const removeAgentBtn = document.getElementById('removeAgentBtn');
        const clearSourcesBtn = document.getElementById('clearSourcesBtn');
        const agentCountDisplay = document.getElementById('agentCount');
        const sourceCountDisplay = document.getElementById('sourceCount');

        // Canvas dimensions
        let width, height;
        
        // Simulation parameters
        let agentCount = 23;
        let agents = [];
        let sources = [];
        const connectionThreshold = 0.0001;
        const minLineWidth = 2;
        const maxLineWidth = 50;
        const maxTailLength = 200;
        let mouse = { x: 0, y: 0 };

        // Function to get accurate mouse position
        function getMousePos(canvas, evt) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            
            return {
                x: (evt.clientX - rect.left) * scaleX,
                y: (evt.clientY - rect.top) * scaleY
            };
        }

        // Resize canvas to fit window
        function resizeCanvas() {
            width = canvas.width = window.innerWidth * 0.7;
            height = canvas.height = window.innerHeight * 0.75;

            // Recalculate agent positions as percentage of new size
            agents.forEach(agent => {
                agent.x = agent.xRatio * width;
                agent.y = agent.yRatio * height;
                agent.baseX = agent.x;
                agent.baseY = agent.y;

                agent.estimate.x = agent.estimateXRatio * width;
                agent.estimate.y = agent.estimateYRatio * height;

                agent.estimateHistory = agent.estimateHistory.map(pos => ({
                    x: pos.x / width * window.innerWidth,
                    y: pos.y / height * window.innerHeight
                }));
            });

            sources = sources.map(source => ({
                x: source.x / width * window.innerWidth,
                y: source.y / height * window.innerHeight
            }));

            width = canvas.width;
            height = canvas.height;
        }

        // Handle window resize
        window.addEventListener('resize', resizeCanvas);

        // Handle canvas clicks
        canvas.addEventListener('click', (e) => {
            if (sources.length < 2) {
                const pos = getMousePos(canvas, e);
                sources.push({ x: pos.x, y: pos.y });
                updateSourceCount();
            }
        });

        // Handle mouse movement
        canvas.addEventListener('mousemove', (e) => {
            const pos = getMousePos(canvas, e);
            mouse.x = pos.x;
            mouse.y = pos.y;
        });

        // Distance calculation
        function distance(a, b) {
            return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
        }

        // Initialize agents
        function initializeAgents() {
            agents = [];
            for (let i = 0; i < agentCount; i++) {
                let x = Math.random() * width;
                let y = Math.random() * height;
                let estimateX = Math.random() * width;
                let estimateY = Math.random() * height;

                agents.push({
                    x,
                    y,
                    baseX: x,
                    baseY: y,
                    estimate: { x: estimateX, y: estimateY },
                    estimateHistory: [],
                    connections: [],
                    xRatio: x / width,
                    yRatio: y / height,
                    estimateXRatio: estimateX / width,
                    estimateYRatio: estimateY / height
                });
            }

            // Create connections between agents
            agents.forEach(agent => {
                let distances = agents
                    .filter(other => other !== agent)
                    .map(other => ({ other, dist: distance(agent, other) }))
                    .sort((a, b) => a.dist - b.dist)
                    .slice(0, 2);

                agent.connections = distances.map(d => d.other);
            });
            
            updateAgentCount();
        }

        // Update agents
        function updateAgents() {
            // Apply mouse repulsion
            agents.forEach(agent => {
                let dx = agent.x - mouse.x;
                let dy = agent.y - mouse.y;
                let dist = Math.sqrt(dx * dx + dy * dy);
                let force = dist < 100 ? (100 - dist) * 0.05 : 0;

                agent.x = agent.baseX + (dx / dist) * force;
                agent.y = agent.baseY + (dy / dist) * force;
            });

            // Update agent estimates
            agents.forEach(agent => {
                if (sources.length === 0) return;

                let stepSize = 0.01;
                const noiseMagnitude = 0.5; // Reduced noise for better convergence

                sources.forEach(source => {
                    let dx = source.x - agent.estimate.x + (Math.random() - 0.5) * noiseMagnitude;
                    let dy = source.y - agent.estimate.y + (Math.random() - 0.5) * noiseMagnitude;
                    agent.estimate.x += stepSize * dx;
                    agent.estimate.y += stepSize * dy;
                });

                // Coordinate with neighbors
                agent.connections.forEach(neighbor => {
                    agent.estimate.x += 0.005 * (neighbor.estimate.x - agent.estimate.x);
                    agent.estimate.y += 0.005 * (neighbor.estimate.y - agent.estimate.y);
                });

                // Store estimate history
                agent.estimateHistory.push({ x: agent.estimate.x, y: agent.estimate.y });
                if (agent.estimateHistory.length > maxTailLength) {
                    agent.estimateHistory.shift();
                }
            });
        }

        // Draw the network
        function drawNetwork() {
            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Draw connections between agents
            agents.forEach(agent => {
                agent.connections.forEach(neighbor => {
                    let dx = agent.x - neighbor.x;
                    let dy = agent.y - neighbor.y;
                    let dist = Math.sqrt(dx * dx + dy * dy);
                    let relativeVariance = 1 / (dist + 1);

                    if (relativeVariance < connectionThreshold)
                        return;

                    let lineWidth = Math.max(minLineWidth, Math.min(relativeVariance * 10, maxLineWidth));

                    ctx.strokeStyle = `rgba(99, 102, 241, ${Math.min(relativeVariance * 10, 1)})`;
                    ctx.lineWidth = lineWidth;
                    ctx.beginPath();
                    ctx.moveTo(agent.x, agent.y);
                    ctx.lineTo(neighbor.x, neighbor.y);
                    ctx.stroke();
                });
            });

            // Draw estimate trails
            agents.forEach(agent => {
                for (let i = 0; i < agent.estimateHistory.length - 1; i++) {
                    let alpha = (i + 1) / agent.estimateHistory.length;
                    ctx.strokeStyle = `rgba(14, 165, 233, ${alpha})`;
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(agent.estimateHistory[i].x, agent.estimateHistory[i].y);
                    ctx.lineTo(agent.estimateHistory[i + 1].x, agent.estimateHistory[i + 1].y);
                    ctx.stroke();
                }
            });

            // Draw agents
            agents.forEach(agent => {
                ctx.fillStyle = '#22c55e';
                ctx.beginPath();
                ctx.arc(agent.x, agent.y, 6, 0, 2 * Math.PI);
                ctx.fill();
            });

            // Draw agent estimates
            agents.forEach(agent => {
                ctx.fillStyle = '#0ea5e9';
                ctx.beginPath();
                ctx.arc(agent.estimate.x, agent.estimate.y, 4, 0, 2 * Math.PI);
                ctx.fill();
            });

            // Draw sources
            sources.forEach(source => {
                ctx.fillStyle = '#ef4444';
                ctx.beginPath();
                ctx.arc(source.x, source.y, 8, 0, 2 * Math.PI);
                ctx.fill();
                
                // Draw pulse effect
                ctx.beginPath();
                ctx.arc(source.x, source.y, 12, 0, 2 * Math.PI);
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
                ctx.lineWidth = 2;
                ctx.stroke();
            });
        }

        // Animation loop
        function animate() {
            updateAgents();
            drawNetwork();
            requestAnimationFrame(animate);
        }

        // Reset simulation
        function resetSimulation() {
            sources = [];
            initializeAgents();
            updateSourceCount();
        }

        // Update agent count display
        function updateAgentCount() {
            agentCountDisplay.textContent = agentCount;
        }

        // Update source count display
        function updateSourceCount() {
            sourceCountDisplay.textContent = sources.length;
        }

        // Add an agent
        function addAgent() {
            agentCount++;
            initializeAgents();
        }

        // Remove an agent
        function removeAgent() {
            if (agentCount > 3) {
                agentCount--;
                initializeAgents();
            }
        }

        // Event listeners for buttons
        resetBtn.addEventListener('click', resetSimulation);
        addAgentBtn.addEventListener('click', addAgent);
        removeAgentBtn.addEventListener('click', removeAgent);
        clearSourcesBtn.addEventListener('click', () => {
            sources = [];
            updateSourceCount();
        });

        // Initialize and start the simulation
        resizeCanvas();
        initializeAgents();
        animate();
function openModal(imageName) {
    var modal = document.getElementById("imgModal");
    var modalImg = document.getElementById("modalImage");
    modal.style.display = "block";
    modalImg.src = imageName;
}

function closeModal() {
    document.getElementById("imgModal").style.display = "none";
}
