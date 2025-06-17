document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('simulationCanvas');
    if (!canvas) {
        console.error("Canvas element not found!");
        return;
    }

    const ctx = canvas.getContext('2d');
    const orderInput = document.getElementById('reflectionOrder');
    const absorptionInput = document.getElementById('absorptionCoefficient');
    const absorptionValue = document.getElementById('absorptionValue');
    const infoText = document.getElementById('info-text');

    let room = { x: 0, y: 0, width: 0, height: 0 };
    let source = null;
    let imageSources = [];
    let maxOrder = parseInt(orderInput.value, 10);
    let absorption = parseFloat(absorptionInput.value);
    const speedOfSound = 343;

    let startTime = 0;
    let animationFrameId = null;

    const SIMULATION_SCALE = 0.25;
    let simWidth, simHeight;
    let imageData, data;

    const viridis = [
        [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 131, 142],
        [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37]
    ];

    function getColor(t) {
        t = Math.max(0, Math.min(1, t));
        const i = Math.floor(t * (viridis.length - 1));
        const j = Math.min(i + 1, viridis.length - 1);
        const f = t * (viridis.length - 1) - i;
        const c1 = viridis[i];
        const c2 = viridis[j];
        return [
            c1[0] + (c2[0] - c1[0]) * f,
            c1[1] + (c2[1] - c1[1]) * f,
            c1[2] + (c2[2] - c1[2]) * f,
        ];
    }

    function setup() {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);

        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;

        const padding = 20;
        room = {
            x: padding,
            y: padding,
            width: canvas.width - 2 * padding,
            height: canvas.height - 2 * padding
        };

        simWidth = Math.floor(room.width * SIMULATION_SCALE);
        simHeight = Math.floor(room.height * SIMULATION_SCALE);
        imageData = ctx.createImageData(simWidth, simHeight);
        data = imageData.data;

        drawInitialState();
    }

    function drawInitialState() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(room.x, room.y, room.width, room.height);
        infoText.textContent = 'Click inside the room to place the sound source';
        source = null;
    }

    function calculateImageSources() {
        if (!source) return;

        imageSources = [];
        const sourceQueue = [{
            ...source,
            order: 0,
            id_x: 0,
            id_y: 0,
            energy: 1.0
        }];
        const visited = new Set(['0,0']);

        let i = 0;
        while (i < sourceQueue.length) {
            const current = sourceQueue[i++];
            imageSources.push(current);

            if (current.order >= maxOrder) continue;

            const next = [
                { x: 2 * room.x - current.x, y: current.y, id_x: -current.id_x - 1, id_y: current.id_y },
                { x: 2 * (room.x + room.width) - current.x, y: current.y, id_x: -current.id_x + 1, id_y: current.id_y },
                { x: current.x, y: 2 * room.y - current.y, id_x: current.id_x, id_y: -current.id_y - 1 },
                { x: current.x, y: 2 * (room.y + room.height) - current.y, id_x: current.id_x, id_y: -current.id_y + 1 }
            ];

            for (const p of next) {
                const id = `${p.id_x},${p.id_y}`;
                if (!visited.has(id)) {
                    visited.add(id);
                    sourceQueue.push({
                        ...p,
                        order: current.order + 1,
                        energy: current.energy * (1 - absorption)
                    });
                }
            }
        }
    }

    function animate() {
        const elapsedTime = (Date.now() - startTime) / 1000;

        for (let y = 0; y < simHeight; y++) {
            for (let x = 0; x < simWidth; x++) {
                const canvasX = room.x + (x / simWidth) * room.width;
                const canvasY = room.y + (y / simHeight) * room.height;
                let totalIntensity = 0;

                imageSources.forEach(is => {
                    const dx = is.x - canvasX;
                    const dy = is.y - canvasY;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    const waveFrontDistance = elapsedTime * speedOfSound;

                    // Energy is present only on the thin wavefront
                    if (Math.abs(distance - waveFrontDistance) <= 5) { // Thin shell
                        totalIntensity += distance > 1 ? is.energy / distance : is.energy;
                    }
                });

                const normalizedIntensity = 20 * Math.log(1 + (totalIntensity) * 10);
                const color = getColor(normalizedIntensity);

                const index = (y * simWidth + x) * 4;
                data[index] = color[0];
                data[index + 1] = color[1];
                data[index + 2] = color[2];
                data[index + 3] = 255;
            }
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = simWidth;
        tempCanvas.height = simHeight;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(imageData, 0, 0);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(tempCanvas, room.x, room.y, room.width, room.height);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 5;
        ctx.strokeRect(room.x, room.y, room.width, room.height);

        animationFrameId = requestAnimationFrame(animate);
    }

    canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        if (mouseX > room.x && mouseX < room.x + room.width &&
            mouseY > room.y && mouseY < room.y + room.height) {

            if (animationFrameId) cancelAnimationFrame(animationFrameId);

            source = { x: mouseX, y: mouseY };
            infoText.textContent = `Source at (${Math.round(source.x)}, ${Math.round(source.y)}). Order: ${maxOrder}, Absorption: ${absorption.toFixed(2)}`;

            calculateImageSources();
            startTime = Date.now();
            animate();
        } else {
            infoText.textContent = 'Please click inside the room boundaries.';
        }
    });

    orderInput.addEventListener('change', () => {
        maxOrder = parseInt(orderInput.value, 10);
        if (source) {
            calculateImageSources();
            infoText.textContent = `Source at (${Math.round(source.x)}, ${Math.round(source.y)}). Order: ${maxOrder}, Absorption: ${absorption.toFixed(2)}`;
        }
    });

    absorptionInput.addEventListener('input', () => {
        absorption = parseFloat(absorptionInput.value);
        absorptionValue.textContent = absorption.toFixed(2);
        if (source) {
            calculateImageSources();
            infoText.textContent = `Source at (${Math.round(source.x)}, ${Math.round(source.y)}). Order: ${maxOrder}, Absorption: ${absorption.toFixed(2)}`;
        }
    });

    window.addEventListener('resize', setup);
    setup();
});
