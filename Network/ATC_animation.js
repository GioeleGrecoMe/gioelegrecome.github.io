const canvas = document.getElementById('networkCanvas');
    const ctx = canvas.getContext('2d');

    const agentCount = 12;
    const agents = [];
    let sources = [];
    const connectionThreshold = 0.00;
    const minLineWidth = 2;
    const maxLineWidth = 50;
    const maxTailLength = 200;
    let mouse = { x: 0, y: 0 };

    canvas.addEventListener('click', (e) => {
      if (sources.length < 2) {
        const rect = canvas.getBoundingClientRect();
        sources.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    });

    function distance(a, b) {
      return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    }

    function initializeAgents() {
      agents.length = 0;
      for (let i = 0; i < agentCount; i++) {
        agents.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          baseX: 0,
          baseY: 0,
          estimate: { x: Math.random() * canvas.width, y: Math.random() * canvas.height },
          estimateHistory: [],
          connections: []
        });
      }

      agents.forEach(agent => {
        agent.baseX = agent.x;
        agent.baseY = agent.y;
      });

      // Establish max 2 connections per agent based on distance
      agents.forEach(agent => {
        let distances = agents
          .filter(other => other !== agent)
          .map(other => ({ other, dist: distance(agent, other) }))
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 2);

        agent.connections = distances.map(d => d.other);
      });
    }

    function updateAgents() {
      agents.forEach(agent => {
        let dx = agent.x - mouse.x;
        let dy = agent.y - mouse.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        let force = dist < 100 ? (100 - dist) * 0.05 : 0;

        agent.x = agent.baseX + (dx / dist) * force;
        agent.y = agent.baseY + (dy / dist) * force;
      });

      agents.forEach(agent => {
        if (sources.length === 0) return;

        let stepSize = 0.01;
        const noiseMagnitude = 1000.5;

        sources.forEach(source => {
          let dx = source.x - agent.estimate.x + (Math.random() - 0.5) * noiseMagnitude;
          let dy = source.y - agent.estimate.y + (Math.random() - 0.5) * noiseMagnitude;
          agent.estimate.x += stepSize * dx;
          agent.estimate.y += stepSize * dy;
        });

        agent.connections.forEach(neighbor => {
          agent.estimate.x += 0.005 * (neighbor.estimate.x - agent.estimate.x);
          agent.estimate.y += 0.005 * (neighbor.estimate.y - agent.estimate.y);
        });

        agent.estimateHistory.push({ x: agent.estimate.x, y: agent.estimate.y });
        if (agent.estimateHistory.length > maxTailLength) {
          agent.estimateHistory.shift();
        }
      });
    }

    function drawNetwork() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

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

      agents.forEach(agent => {
        for (let i = 0; i < agent.estimateHistory.length - 1; i++) {
          let alpha = (i + 1) / agent.estimateHistory.length;
          ctx.strokeStyle = `rgba(14+${alpha}, 165, 233, ${alpha})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(agent.estimateHistory[i].x, agent.estimateHistory[i].y);
          ctx.lineTo(agent.estimateHistory[i + 1].x, agent.estimateHistory[i + 1].y);
          ctx.stroke();
        }
      });

      agents.forEach(agent => {
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(agent.x, agent.y, 6, 0, 2 * Math.PI);
        ctx.fill();
      });

      agents.forEach(agent => {
        ctx.fillStyle = '#0ea5e9';
        ctx.beginPath();
        ctx.arc(agent.estimate.x, agent.estimate.y, 4, 0, 2 * Math.PI);
        ctx.fill();
      });

      sources.forEach(source => {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(source.x, source.y, 8, 0, 2 * Math.PI);
        ctx.fill();
      });
    }

    function animate() {
      updateAgents();
      drawNetwork();
      requestAnimationFrame(animate);
    }

    function resetSimulation() {
      sources = [];
      initializeAgents();
    }

    initializeAgents();
    animate();