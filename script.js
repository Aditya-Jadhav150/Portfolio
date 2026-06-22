document.addEventListener('DOMContentLoaded', () => {

    // Simple HTML sanitizer to prevent Self-XSS
    function escapeHTML(str) {
        if (typeof str !== 'string') return str;
        return str.replace(/[&<>'"]/g, tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag]));
    }

    /* ==========================================================================
       SIDEBAR DRAWER TOGGLE (Chat Assistant Open/Close)
       ========================================================================== */
    const chatFabTrigger = document.getElementById('chat-fab-trigger');
    const chatSidebarClose = document.getElementById('chat-sidebar-close');
    const chatSidebar = document.getElementById('chat-sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    
    let chatInitialized = false;

    /* ==========================================================================
       THREE.JS NEURAL NETWORK ENGINE
       ========================================================================== */
    const canvas = document.getElementById('chat-cosmic-canvas');
    let renderer, scene, camera, clock;
    let isRendering = false;
    let sidebarAspect = 1.0;

    // Node objects, connections, packets, and ripples arrays
    const nodeObjects = [];
    const connections = [];
    const activePackets = [];
    const activeRipples = [];

    // WebGL Object variables
    let layer0Geometry, layer0Material, layer0Points;
    let layer1Geometry, layer1Material, layer1Points;
    let layer2Geometry, layer2Material, layer2Points;
    let lineGeometry, lineMaterial, lineSegments;
    let packetGeometry, packetMaterial, packetPoints;

    // Parallax & Mouse Attraction coordinates
    let targetMouseX = 0, targetMouseY = 0;
    let currentMouseX = 0, currentMouseY = 0;

    const cosmicOpacity = { value: 0 };
    const maxPacketsCount = 120;

    if (canvas) {
        // Initialize Scene, Camera, Clock
        scene = new THREE.Scene();
        clock = new THREE.Clock();

        camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
        camera.position.z = 5;

        renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            alpha: true,
            antialias: true
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Helper to generate soft circular particle textures dynamically
        function createCircleTexture(color = '#ffffff', size = 16) {
            const texCanvas = document.createElement('canvas');
            texCanvas.width = size;
            texCanvas.height = size;
            const ctx = texCanvas.getContext('2d');
            const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
            grad.addColorStop(0, color);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, size, size);
            return new THREE.CanvasTexture(texCanvas);
        }

        // 1. Generate 3 layers of neural network nodes
        function generateLayerNodes(count, minZ, maxZ, layerIndex, baseColorHex) {
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(count * 3);
            const colors = new Float32Array(count * 3);

            for (let i = 0; i < count; i++) {
                // Spread coordinates within wider bounding boxes to cover full canvas area
                const x = (Math.random() - 0.5) * 10.0;
                const y = (Math.random() - 0.5) * 6.5;
                const z = minZ + Math.random() * (maxZ - minZ);

                positions[i * 3] = x;
                positions[i * 3 + 1] = y;
                positions[i * 3 + 2] = z;

                // Occasional violet highlight node (15% chance in midground/foreground)
                let nodeColorHex = baseColorHex;
                if (layerIndex > 0 && Math.random() < 0.15) {
                    nodeColorHex = '#c084fc';
                }
                const baseColor = new THREE.Color(nodeColorHex);

                colors[i * 3] = baseColor.r;
                colors[i * 3 + 1] = baseColor.g;
                colors[i * 3 + 2] = baseColor.b;

                // Store node attributes for runtime physics and animation
                nodeObjects.push({
                    position: new THREE.Vector3(x, y, z),
                    originX: x,
                    originY: y,
                    originZ: z,
                    phaseX: Math.random() * Math.PI * 2,
                    phaseY: Math.random() * Math.PI * 2,
                    phaseZ: Math.random() * Math.PI * 2,
                    layerIndex: layerIndex,
                    indexInLayer: i,
                    layerGeometry: geometry,
                    baseColor: baseColor.clone(),
                    rippleBoost: 0
                });
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            return geometry;
        }

        // Layer 0: Background Layer (Smallest, dim navy/indigo nodes)
        layer0Geometry = generateLayerNodes(160, -6.0, -3.0, 0, '#1e1b4b');
        layer0Material = new THREE.PointsMaterial({
            size: 0.04,
            map: createCircleTexture('#ffffff', 16),
            transparent: true,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: 0
        });
        layer0Points = new THREE.Points(layer0Geometry, layer0Material);
        scene.add(layer0Points);

        // Layer 1: Mid-depth Layer (Medium, glowing blue nodes)
        layer1Geometry = generateLayerNodes(120, -3.0, 0.0, 1, '#0ea5e9');
        layer1Material = new THREE.PointsMaterial({
            size: 0.085,
            map: createCircleTexture('#ffffff', 32),
            transparent: true,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: 0
        });
        layer1Points = new THREE.Points(layer1Geometry, layer1Material);
        scene.add(layer1Points);

        // Layer 2: Foreground Layer (Largest, cyan nodes)
        layer2Geometry = generateLayerNodes(45, 0.0, 1.8, 2, '#22d3ee');
        layer2Material = new THREE.PointsMaterial({
            size: 0.14,
            map: createCircleTexture('#ffffff', 32),
            transparent: true,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: 0
        });
        layer2Points = new THREE.Points(layer2Geometry, layer2Material);
        scene.add(layer2Points);

        // 2. Pre-calculate connections between neighboring nodes (volumetric, cross-layer connections)
        function connectNodes() {
            const getDistance = (n1, n2) => {
                const dx = n1.originX - n2.originX;
                const dy = n1.originY - n2.originY;
                const dz = n1.originZ - n2.originZ;
                return Math.sqrt(dx*dx + dy*dy + dz*dz);
            };

            for (let i = 0; i < nodeObjects.length; i++) {
                const nodeA = nodeObjects[i];
                const neighbors = [];
                // Connect to closest nodes in 3D to form a single continuous organic brain
                const maxDist = 2.1;
                const maxConns = 3;

                for (let j = i + 1; j < nodeObjects.length; j++) {
                    const nodeB = nodeObjects[j];
                    const d = getDistance(nodeA, nodeB);
                    if (d < maxDist) {
                        neighbors.push({ index: j, dist: d });
                    }
                }

                // Connect only to nearest neighbors to prevent messy webs
                neighbors.sort((a, b) => a.dist - b.dist);
                const limit = Math.min(neighbors.length, maxConns);
                for (let n = 0; n < limit; n++) {
                    const nodeB = nodeObjects[neighbors[n].index];
                    const baseColor = nodeA.baseColor.clone().lerp(nodeB.baseColor, 0.5).multiplyScalar(0.45);
                    connections.push({
                        from: i,
                        to: neighbors[n].index,
                        baseColor: baseColor,
                        dist: neighbors[n].dist
                    });
                }
            }
        }
        connectNodes();

        // 3. Build connection lines segments geometry
        lineGeometry = new THREE.BufferGeometry();
        const linePositions = new Float32Array(connections.length * 2 * 3);
        const lineColors = new Float32Array(connections.length * 2 * 3);

        connections.forEach((conn, idx) => {
            const nodeA = nodeObjects[conn.from];
            const nodeB = nodeObjects[conn.to];

            linePositions[idx * 6] = nodeA.position.x;
            linePositions[idx * 6 + 1] = nodeA.position.y;
            linePositions[idx * 6 + 2] = nodeA.position.z;
            linePositions[idx * 6 + 3] = nodeB.position.x;
            linePositions[idx * 6 + 4] = nodeB.position.y;
            linePositions[idx * 6 + 5] = nodeB.position.z;

            lineColors[idx * 6] = conn.baseColor.r;
            lineColors[idx * 6 + 1] = conn.baseColor.g;
            lineColors[idx * 6 + 2] = conn.baseColor.b;
            lineColors[idx * 6 + 3] = conn.baseColor.r;
            lineColors[idx * 6 + 4] = conn.baseColor.g;
            lineColors[idx * 6 + 5] = conn.baseColor.b;
        });

        lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
        lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

        lineMaterial = new THREE.LineBasicMaterial({
            transparent: true,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: 0
        });

        lineSegments = new THREE.LineSegments(lineGeometry, lineMaterial);
        scene.add(lineSegments);

        // 4. Set up Active Data Packets simulation
        packetGeometry = new THREE.BufferGeometry();
        const packetPositions = new Float32Array(maxPacketsCount * 3);
        const packetColors = new Float32Array(maxPacketsCount * 3);

        packetGeometry.setAttribute('position', new THREE.BufferAttribute(packetPositions, 3));
        packetGeometry.setAttribute('color', new THREE.BufferAttribute(packetColors, 3));

        packetMaterial = new THREE.PointsMaterial({
            size: 3.5,
            sizeAttenuation: false, // Specifies size in screen pixels directly
            map: createCircleTexture('#ffffff', 32),
            transparent: true,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: 0
        });

        packetPoints = new THREE.Points(packetGeometry, packetMaterial);
        scene.add(packetPoints);

        // Spawn initial pool of data packets distributed across different connection lines
        for (let i = 0; i < 25; i++) {
            const connIdx = Math.floor(Math.random() * connections.length);
            const conn = connections[connIdx];
            const nodeA = nodeObjects[conn.from];
            const colorsList = [
                new THREE.Color('#38bdf8'), // cyan
                new THREE.Color('#3b82f6'), // blue
                new THREE.Color('#818cf8'), // indigo
                new THREE.Color('#c084fc')  // violet
            ];
            const randomColor = colorsList[Math.floor(Math.random() * colorsList.length)];
            
            activePackets.push({
                connIndex: connIdx,
                progress: Math.random(),
                speed: 0.35 + Math.random() * 0.45,
                speedMultiplier: 1.0,
                direction: Math.random() > 0.5 ? 1 : -1,
                position: new THREE.Vector3().copy(nodeA.position),
                layerColor: randomColor
            });
        }

        // Volumetric nebula cloud removed per user request

        // Sidebar dimensions handler
        function updateSidebarDimensions() {
            if (!chatSidebar) return;
            const bounds = chatSidebar.getBoundingClientRect();
            const w = bounds.width || window.innerWidth;
            const h = bounds.height || (window.innerHeight * 0.6);
            sidebarAspect = w / h;
            if (renderer && camera) {
                renderer.setSize(w, h);
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
            }
        }

        window.addEventListener('resize', updateSidebarDimensions);
        updateSidebarDimensions();

        // Mouse Parallax coordinates listener
        window.addEventListener('mousemove', (e) => {
            if (!isRendering) return;
            targetMouseX = (e.clientX / window.innerWidth) - 0.5;
            targetMouseY = (e.clientY / window.innerHeight) - 0.5;
        });
    }

    // Thinking ripple trigger function
    function triggerThinkingRipple(x = 0, y = -2.2) {
        activeRipples.push({
            origin: new THREE.Vector3(x, y, 0.5),
            radius: 0.0,
            maxRadius: 11.5,
            speed: 6.5, // units per second propagation
            intensity: 1.0
        });
    }

    // Define centralized GSAP timeline for bottom sheet transitions
    const chatTimeline = gsap.timeline({
        paused: true,
        onStart: () => {
            if (chatSidebar) chatSidebar.classList.add('open');
        },
        onReverseComplete: () => {
            if (chatSidebar) chatSidebar.classList.remove('open');
            isRendering = false; // Stop WebGL render loop when completely closed to save CPU
        }
    });

    // Configure initial styles of Three.js objects to start from bottom state
    gsap.set(chatSidebar, { y: '100%' });
    gsap.set('.chat-glass-content', { opacity: 0, y: 20 });
    
    chatTimeline
        .to(chatSidebar, {
            y: '0%',
            duration: 0.85,
            ease: "power4.out"
        }, 0)
        // Neural network base opacity gradually fades in behind the rising glass panel
        .to(cosmicOpacity, {
            value: 1.0,
            duration: 0.9,
            ease: "power2.out"
        }, 0.15)
        // Glass overlay panel fades in
        .to('.chat-glass-content', {
            opacity: 1,
            y: 0,
            pointerEvents: "auto",
            duration: 0.6,
            ease: "power3.out"
        }, 0.2)
        .fromTo([
            '.sidebar-header',
            '.chat-history',
            '.chat-input-wrapper',
            '.chat-sub-footer'
        ], {
            opacity: 0,
            y: 15
        }, {
            opacity: 1,
            y: 0,
            duration: 0.45,
            stagger: 0.08,
            ease: "power2.out"
        }, 0.3);

    // WebGL animation render loop
    function animate() {
        if (!isRendering) return;
        requestAnimationFrame(animate);

        const time = clock.getElapsedTime();
        const dt = Math.min(clock.getDelta(), 0.1); // clamp delta to prevent skips

        // 1. Update Thinking Ripples
        activeRipples.forEach((rip, idx) => {
            rip.radius += rip.speed * dt;
            if (rip.radius > rip.maxRadius) {
                activeRipples.splice(idx, 1);
            }
        });

        // 2. Parallax mouse interpolation
        currentMouseX += (targetMouseX - currentMouseX) * 0.06;
        currentMouseY += (targetMouseY - currentMouseY) * 0.06;

        // Parallax is applied directly to node position vectors for seamless cross-layer tracking

        // 3. Update Nodes Physics (Drift + Parallax Mouse Attraction + Ripples)
        const mouse3D = new THREE.Vector3(currentMouseX * sidebarAspect * 6.5, -currentMouseY * 4.5, 0.5);

        nodeObjects.forEach((node) => {
            // Organic slow drift
            const driftX = Math.sin(time * 0.4 + node.phaseX) * 0.15;
            const driftY = Math.cos(time * 0.4 + node.phaseY) * 0.15;
            const driftZ = Math.sin(time * 0.3 + node.phaseZ) * 0.1;

            // Subtle mouse cursor attraction
            const dx = mouse3D.x - node.originX;
            const dy = mouse3D.y - node.originY;
            const dist2D = Math.sqrt(dx*dx + dy*dy);
            
            let attractionX = 0;
            let attractionY = 0;
            if (dist2D < 2.5) {
                const strength = (1.0 - dist2D / 2.5) * 0.35;
                attractionX = dx * strength;
                attractionY = dy * strength;
            }

            // Calculate parallax offset based on depth layer to prevent tearing in cross-layer connections
            let parallaxFactor = 0.18;
            if (node.layerIndex === 1) parallaxFactor = 0.36;
            if (node.layerIndex === 2) parallaxFactor = 0.54;

            const parallaxX = currentMouseX * parallaxFactor;
            const parallaxY = -currentMouseY * parallaxFactor;

            node.position.set(
                node.originX + driftX + attractionX + parallaxX,
                node.originY + driftY + attractionY + parallaxY,
                node.originZ + driftZ
            );

            // Ripple brightness calculation
            let rippleBoost = 0;
            activeRipples.forEach((rip) => {
                const d = node.position.distanceTo(rip.origin);
                const distToFront = Math.abs(d - rip.radius);
                if (distToFront < 1.2) {
                    const strength = 1.0 - distToFront / 1.2;
                    rippleBoost += strength * rip.intensity * 1.5;
                }
            });

            node.rippleBoost = rippleBoost;

            // Set positions inside layer geometries
            const posAttr = node.layerGeometry.attributes.position;
            posAttr.setXYZ(node.indexInLayer, node.position.x, node.position.y, node.position.z);

            // Set dynamic vertex colors for ripple illumination
            const colAttr = node.layerGeometry.attributes.color;
            const baseCol = node.baseColor;
            const r = Math.min(1.0, baseCol.r + rippleBoost * 0.65);
            const g = Math.min(1.0, baseCol.g + rippleBoost * 0.9);
            const b = Math.min(1.0, baseCol.b + rippleBoost * 0.95);
            colAttr.setXYZ(node.indexInLayer, r, g, b);
        });

        layer0Geometry.attributes.position.needsUpdate = true;
        layer0Geometry.attributes.color.needsUpdate = true;
        layer1Geometry.attributes.position.needsUpdate = true;
        layer1Geometry.attributes.color.needsUpdate = true;
        layer2Geometry.attributes.position.needsUpdate = true;
        layer2Geometry.attributes.color.needsUpdate = true;

        // 4. Update Connection Lines Segments
        const linePositions = lineGeometry.attributes.position.array;
        const lineColors = lineGeometry.attributes.color.array;
        let linePosIdx = 0;
        let lineColIdx = 0;

        connections.forEach((conn) => {
            const nodeA = nodeObjects[conn.from];
            const nodeB = nodeObjects[conn.to];

            linePositions[linePosIdx++] = nodeA.position.x;
            linePositions[linePosIdx++] = nodeA.position.y;
            linePositions[linePosIdx++] = nodeA.position.z;
            linePositions[linePosIdx++] = nodeB.position.x;
            linePositions[linePosIdx++] = nodeB.position.y;
            linePositions[linePosIdx++] = nodeB.position.z;

            // Average ripple boost of connection end points
            const avgBoost = (nodeA.rippleBoost + nodeB.rippleBoost) / 2;
            const baseCol = conn.baseColor;
            const r = Math.min(1.0, baseCol.r + avgBoost * 0.45);
            const g = Math.min(1.0, baseCol.g + avgBoost * 0.8);
            const b = Math.min(1.0, baseCol.b + avgBoost * 0.85);

            lineColors[lineColIdx++] = r;
            lineColors[lineColIdx++] = g;
            lineColors[lineColIdx++] = b;
            lineColors[lineColIdx++] = r;
            lineColors[lineColIdx++] = g;
            lineColors[lineColIdx++] = b;
        });

        lineGeometry.attributes.position.needsUpdate = true;
        lineGeometry.attributes.color.needsUpdate = true;

        // 5. Update Active Data Packets (Flow & Ripples Acceleration)
        const packetPositions = packetGeometry.attributes.position.array;
        const packetColors = packetGeometry.attributes.color.array;
        let packetPosIdx = 0;
        let packetColIdx = 0;

        // Clean up packets marked for deletion
        for (let i = activePackets.length - 1; i >= 0; i--) {
            if (activePackets[i].toBeDeleted) {
                activePackets.splice(i, 1);
            }
        }

        // AI Response Effect packet target (spikes up during ripples)
        const targetPacketsCount = activeRipples.length > 0 ? 55 : 25;

        // Spawn new packets if we are below the target
        while (activePackets.length < targetPacketsCount) {
            const connIdx = Math.floor(Math.random() * connections.length);
            const conn = connections[connIdx];
            if (conn) {
                const nodeA = nodeObjects[conn.from];
                const colorsList = [
                    new THREE.Color('#38bdf8'), // cyan
                    new THREE.Color('#3b82f6'), // blue
                    new THREE.Color('#818cf8'), // indigo
                    new THREE.Color('#c084fc')  // violet
                ];
                const randomColor = colorsList[Math.floor(Math.random() * colorsList.length)];

                activePackets.push({
                    connIndex: connIdx,
                    progress: 0.0,
                    speed: 0.35 + Math.random() * 0.45,
                    speedMultiplier: 1.0,
                    direction: Math.random() > 0.5 ? 1 : -1,
                    position: new THREE.Vector3().copy(nodeA.position),
                    layerColor: randomColor
                });
            }
        }

        activePackets.forEach((p) => {
            const conn = connections[p.connIndex];
            if (!conn) {
                p.toBeDeleted = true;
                return;
            }
            const nodeA = nodeObjects[conn.from];
            const nodeB = nodeObjects[conn.to];

            // Accelerate packets inside the ripple front
            const avgBoost = (nodeA.rippleBoost + nodeB.rippleBoost) / 2;
            p.speedMultiplier += (1.0 + avgBoost * 2.2 - p.speedMultiplier) * 0.08;

            p.progress += p.speed * dt * p.speedMultiplier;

            if (p.progress >= 1.0) {
                const arrivalNodeIdx = p.direction === 1 ? conn.to : conn.from;

                // Chance of dying at node if we have more than the active target count
                if (Math.random() < 0.15 && activePackets.length > targetPacketsCount) {
                    p.toBeDeleted = true;
                    return;
                }

                // Find potential branches from destination node
                const nextBranches = [];
                connections.forEach((c, cIdx) => {
                    if (cIdx !== p.connIndex && (c.from === arrivalNodeIdx || c.to === arrivalNodeIdx)) {
                        nextBranches.push(cIdx);
                    }
                });

                if (nextBranches.length > 0) {
                    // Split behavior: with a 25% chance, spawn an extra packet on a different branch
                    if (Math.random() < 0.25 && activePackets.length < maxPacketsCount) {
                        const spawnConnIdx = nextBranches[Math.floor(Math.random() * nextBranches.length)];
                        const spawnConn = connections[spawnConnIdx];
                        if (spawnConn) {
                            const colorsList = [
                                new THREE.Color('#38bdf8'), // cyan
                                new THREE.Color('#3b82f6'), // blue
                                new THREE.Color('#818cf8'), // indigo
                                new THREE.Color('#c084fc')  // violet
                            ];
                            const randomColor = colorsList[Math.floor(Math.random() * colorsList.length)];
                            
                            activePackets.push({
                                connIndex: spawnConnIdx,
                                progress: 0.0,
                                speed: 0.35 + Math.random() * 0.45,
                                speedMultiplier: p.speedMultiplier,
                                direction: spawnConn.from === arrivalNodeIdx ? 1 : -1,
                                position: new THREE.Vector3(),
                                layerColor: randomColor
                            });
                        }
                    }

                    // Original packet continues along one branch
                    p.connIndex = nextBranches[Math.floor(Math.random() * nextBranches.length)];
                    const nextConn = connections[p.connIndex];
                    p.direction = nextConn.from === arrivalNodeIdx ? 1 : -1;
                    p.progress = 0.0;
                } else {
                    // Dead end, reset to random connection or terminate
                    if (activePackets.length > 20) {
                        p.toBeDeleted = true;
                    } else {
                        p.connIndex = Math.floor(Math.random() * connections.length);
                        p.direction = Math.random() > 0.5 ? 1 : -1;
                        p.progress = 0.0;
                    }
                }
            }

            // Interpolate position along line coordinates
            const nodeStart = p.direction === 1 ? nodeA : nodeB;
            const nodeEnd = p.direction === 1 ? nodeB : nodeA;
            p.position.copy(nodeStart.position).lerp(nodeEnd.position, p.progress);

            packetPositions[packetPosIdx++] = p.position.x;
            packetPositions[packetPosIdx++] = p.position.y;
            packetPositions[packetPosIdx++] = p.position.z;

            // Packet illumination when speed is boosted by ripples
            const baseCol = p.layerColor;
            const glow = Math.min(1.0, 1.0 + (p.speedMultiplier - 1.0) * 0.4);
            packetColors[packetColIdx++] = baseCol.r * glow;
            packetColors[packetColIdx++] = baseCol.g * glow;
            packetColors[packetColIdx++] = baseCol.b * glow;
        });

        // Hide unused buffer spots offscreen
        for (let i = activePackets.length; i < maxPacketsCount; i++) {
            packetPositions[packetPosIdx++] = 999;
            packetPositions[packetPosIdx++] = 999;
            packetPositions[packetPosIdx++] = 999;
            packetColors[packetColIdx++] = 0;
            packetColors[packetColIdx++] = 0;
            packetColors[packetColIdx++] = 0;
        }

        packetGeometry.attributes.position.needsUpdate = true;
        packetGeometry.attributes.color.needsUpdate = true;

        // 6. Update Opacities dynamically based on cosmicOpacity timeline values (with subtle breathing/shimmering animation)
        layer0Material.opacity = cosmicOpacity.value * 0.45 * (0.9 + Math.sin(time * 1.2) * 0.1);
        layer1Material.opacity = cosmicOpacity.value * 0.75 * (0.95 + Math.sin(time * 2.0) * 0.05);
        layer2Material.opacity = cosmicOpacity.value * 0.95 * (0.9 + Math.sin(time * 1.6) * 0.1);
        lineMaterial.opacity = cosmicOpacity.value * 0.32 * (0.85 + Math.sin(time * 1.5) * 0.15);
        packetMaterial.opacity = cosmicOpacity.value * 0.95;

        renderer.render(scene, camera);
    }

    function openSidebar() {
        if (!chatSidebar || !sidebarOverlay) return;
        sidebarOverlay.classList.add('active');
        
        // Start Three.js WebGL animation loop
        if (!isRendering) {
            isRendering = true;
            clock.getDelta(); // reset clock delta
            animate();
        }

        chatTimeline.play();
        
        // Disable page scroll when chat drawer is open on mobile
        if (window.innerWidth <= 868) {
            document.body.style.overflow = 'hidden';
        }

        // Initialize conversational representative on first open
        if (!chatInitialized) {
            chatInitialized = true;
            initializeChat();
        }
    }

    function closeSidebar() {
        if (!chatSidebar || !sidebarOverlay) return;
        chatTimeline.reverse();
        sidebarOverlay.classList.remove('active');
        document.body.style.overflow = 'auto'; // restore scroll
    }

    if (chatFabTrigger) {
        chatFabTrigger.addEventListener('click', openSidebar);
    }

    if (chatSidebarClose) {
        chatSidebarClose.addEventListener('click', closeSidebar);
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeSidebar);
    }


    /* ==========================================================================
       MOBILE MENU TOGGLE (Header Navigation)
       ========================================================================== */
    const menuToggle = document.getElementById('menu-toggle');
    const navMenu = document.getElementById('nav-menu');
    const navLinksList = document.querySelectorAll('.nav-links a');

    if (menuToggle && navMenu) {
        menuToggle.addEventListener('click', () => {
            navMenu.classList.toggle('active');
            const icon = menuToggle.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-bars');
                icon.classList.toggle('fa-xmark');
            }
        });
    }

    navLinksList.forEach(link => {
        link.addEventListener('click', () => {
            if (navMenu && navMenu.classList.contains('active')) {
                navMenu.classList.remove('active');
                const icon = menuToggle.querySelector('i');
                if (icon) {
                    icon.classList.add('fa-bars');
                    icon.classList.remove('fa-xmark');
                }
            }
        });
    });


    /* ==========================================================================
       CONVERSATIONAL CHAT ENGINE (Sidebar Panel)
       ========================================================================== */
    const chatHistoryLogs = document.getElementById('chat-history-logs');

    // Rich Data templates to render inside chat bubbles
    const templates = {
        skills: `
            <div class="chat-skills-list">
                <div class="chat-skill-group">
                    <h5>Languages</h5>
                    <div class="chat-skill-tags">
                        <span class="chat-skill-tag">Python</span>
                        <span class="chat-skill-tag">SQL</span>
                        <span class="chat-skill-tag">JavaScript</span>
                        <span class="chat-skill-tag">C</span>
                        <span class="chat-skill-tag">Java</span>
                    </div>
                </div>
                <div class="chat-skill-group">
                    <h5>Web Stack</h5>
                    <div class="chat-skill-tags">
                        <span class="chat-skill-tag">React</span>
                        <span class="chat-skill-tag">Next.js</span>
                        <span class="chat-skill-tag">FastAPI</span>
                        <span class="chat-skill-tag">HTML5/CSS3</span>
                    </div>
                </div>
                <div class="chat-skill-group">
                    <h5>ML & AI</h5>
                    <div class="chat-skill-tags">
                        <span class="chat-skill-tag">TensorFlow</span>
                        <span class="chat-skill-tag">PyTorch</span>
                        <span class="chat-skill-tag">CNNs</span>
                        <span class="chat-skill-tag">RAG Systems</span>
                        <span class="chat-skill-tag">Generative AI</span>
                    </div>
                </div>
                <div class="chat-skill-group">
                    <h5>Developer Tools</h5>
                    <div class="chat-skill-tags">
                        <span class="chat-skill-tag">Git</span>
                        <span class="chat-skill-tag">VS Code</span>
                        <span class="chat-skill-tag">Docker</span>
                        <span class="chat-skill-tag">Android Studio</span>
                        <span class="chat-skill-tag">Chrome Ext APIs</span>
                    </div>
                </div>
            </div>
        `,
        project_tnc: `
            <div class="chat-inline-card">
                <h4>🛡️ TnC-Bot (Legal Interpreter)</h4>
                <p>An AI-powered Terms & Conditions analyzer featuring a React SPA, FastAPI backend, SQLite vector database, Chrome extension, and Android Accessibility Service. Ingests PDFs/Scans using PyMuPDF and PyTesseract OCR, performs local cosine similarity search, and translates legalese to plain language.</p>
                <div class="tech-list">
                    <span class="tech-tag">FastAPI</span>
                    <span class="tech-tag">React</span>
                    <span class="tech-tag">SQLite</span>
                    <span class="tech-tag">Android Service</span>
                    <span class="tech-tag">Chrome Ext</span>
                </div>
                <div class="chat-card-footer">
                    <a href="https://github.com/Aditya-Jadhav150/TnC-Bot.git" target="_blank" class="chat-card-link"><i class="fa-brands fa-github"></i> Repository</a>
                </div>
            </div>
        `,
        project_talentlens: `
            <div class="chat-inline-card">
                <h4>🎯 TalentLens-AI (Assessment Platform)</h4>
                <p>An AI-driven recruitment and technical evaluation platform utilizing Next.js, Clerk Auth, and OpenAI. Includes candidate profiling enriched by GitHub/LinkedIn scraping APIs (Bright Data, Microlink) and features an interactive technical interviewer with a cynical risk evaluator persona (Agent Ada) to test candidate decisions.</p>
                <div class="tech-list">
                    <span class="tech-tag">Next.js</span>
                    <span class="tech-tag">TypeScript</span>
                    <span class="tech-tag">OpenAI API</span>
                    <span class="tech-tag">Clerk Auth</span>
                </div>
                <div class="chat-card-footer">
                    <a href="https://github.com/Aditya-Jadhav150/TalentLens-AI.git" target="_blank" class="chat-card-link"><i class="fa-brands fa-github"></i> Repository</a>
                </div>
            </div>
        `,
        project_deepfake: `
            <div class="chat-inline-card">
                <h4>🛡️ Aegis AI (Deepfake Detection)</h4>
                <p>A secure production-grade deepfake detection platform featuring a Flask full-stack runtime, SQLite database persistence, and a Hugging Face Vision Transformer (ViT) inference engine. Incorporates a custom local training workflow utilizing an EfficientNet-B3 network with Mixup regularization.</p>
                <div class="tech-list">
                    <span class="tech-tag">Python</span>
                    <span class="tech-tag">PyTorch</span>
                    <span class="tech-tag">Flask</span>
                    <span class="tech-tag">SQLite</span>
                    <span class="tech-tag">Hugging Face</span>
                </div>
                <div class="chat-card-footer">
                    <a href="https://github.com/Aditya-Jadhav150/AEGIS-AI.git" target="_blank" class="chat-card-link"><i class="fa-brands fa-github"></i> Repository</a>
                </div>
            </div>
        `,
        project_exonyx: `
            <div class="chat-inline-card">
                <h4>🚀 EXONYX (Full-Stack AI App)</h4>
                <p>A high-performance modern web application integrating advanced AI workflows to streamline digital processes. Deployed seamlessly on Vercel with a responsive Next.js frontend architecture.</p>
                <div class="tech-list">
                    <span class="tech-tag">Next.js</span>
                    <span class="tech-tag">React</span>
                    <span class="tech-tag">AI/ML</span>
                    <span class="tech-tag">Vercel</span>
                </div>
                <div class="chat-card-footer">
                    <a href="https://github.com/Aditya-Jadhav150/EXONYX.git" target="_blank" class="chat-card-link"><i class="fa-brands fa-github"></i> Repository</a>
                </div>
            </div>
        `,
        certs: `
            <div class="chat-inline-card">
                <h4>🛡️ Docker & Python for ML Training</h4>
                <p>Completed Spoken Tutorial examinations organized by MVSR Engineering College with course materials provided by <strong>EduPyramids, SINE, IIT Bombay</strong>.</p>
                <p style="font-size:0.8rem; margin-top:2px;">
                    \u2022 <strong>Python for ML</strong>: April 2026 | Score: <strong>96.00%</strong> (2 Credits)<br>
                    \u2022 <strong>Docker Training</strong>: May 2026 | Score: <strong>94.00%</strong> (2 Credits)
                </p>
            </div>
            <div class="chat-inline-card">
                <h4>☁️ Microsoft Learn Certifications</h4>
                <p>Completed AI and Cloud computing modules signed by Satya Nadella (May 2026):</p>
                <p style="font-size:0.8rem; margin-top:2px;">
                    \u2022 <em>Introduction to Generative AI & Agents</em><br>
                    \u2022 <em>Introduction to AI Concepts</em><br>
                    \u2022 <em>Describe Cloud Computing</em>
                </p>
            </div>
        `,
        achievements: `
            <div class="chat-inline-card">
                <h4>🏆 Forge Inspira Hackathon 2026</h4>
                <p>Secured <strong>Rank #23 out of 303</strong> teams (Top 8% overall) at IIT Hyderabad, March 2026. Collaborated in a fast-paced environment to build AI-driven solutions.</p>
            </div>
            <div class="chat-inline-card">
                <h4>🎮 E-Gaming & CSI Chapters</h4>
                <p>Active participant in Forge Inspira 2026 E-Gaming Competitions and student member of the Computer Society of India (CSI).</p>
            </div>
        `
    };

    // Chat dialogue state tree
    const chatTree = {
        welcome: {
            text: "👋 Hello! I'm <span class=\"highlight-cyan\">Aditya's AI Assistant</span>.<br><br>I can walk you through his skills, projects, code repositories, and achievements in real-time.<br><br>What would you like to explore?",
            options: [
                { text: "📁 View Projects", next: "projects" },
                { text: "⚡ Technical Skills", next: "skills" },
                { text: "🏆 Certifications & Achievements", next: "certs" },
                { text: "📄 Get Resume", next: "resume" },
                { text: "✉️ Say Hello", next: "contact" }
            ]
        },
        main_menu: {
            text: "Sure! What would you like to explore next?",
            options: [
                { text: "📁 View Projects", next: "projects" },
                { text: "⚡ Technical Skills", next: "skills" },
                { text: "🏆 Certifications & Achievements", next: "certs" },
                { text: "📄 Get Resume", next: "resume" },
                { text: "✉️ Say Hello", next: "contact" }
            ]
        },
        projects: {
            text: "Aditya has built several AI-driven and fullstack projects. I can compile details for these. Select a project to inspect:",
            options: [
                { text: "🚀 EXONYX", next: "proj_exonyx" },
                { text: "🛡️ Aegis AI", next: "proj_deepfake" },
                { text: "🎯 TalentLens-AI (Agents)", next: "proj_talentlens" },
                { text: "🛡️ TnC-Bot (RAG/Android)", next: "proj_tnc" },
                { text: "🔙 Go Back", next: "main_menu" }
            ]
        },
        skills: {
            text: "Here is Aditya's current technical skill matrix. He keeps things updated while prototyping and building:",
            rich: templates.skills,
            options: [
                { text: "📁 View Projects", next: "projects" },
                { text: "🏆 Achievements", next: "certs" },
                { text: "🔙 Main Menu", next: "main_menu" }
            ]
        },
        certs: {
            text: "Here are Aditya's certified training paths and hackathon credentials:",
            rich: templates.certs + templates.achievements,
            options: [
                { text: "📁 View Projects", next: "projects" },
                { text: "✉️ Get in Touch", next: "contact" },
                { text: "🔙 Main Menu", next: "main_menu" }
            ]
        },
        resume: {
            text: "You can download Aditya's complete and updated resume in Word format here. It contains all detail lists regarding his MVSR IT studies, IIT Bombay trainings, and hackathons:",
            rich: `
                <div class="chat-inline-card" style="text-align: center;">
                    <i class="fa-regular fa-file-word" style="font-size: 2.5rem; color: #2b579a; margin-bottom: 8px;"></i>
                    <h4>ADITYA_JADHAV_RESUME.docx</h4>
                    <p style="font-size: 0.8rem;">Size: ~28 KB | Restructured & Verified</p>
                    <div style="margin-top: 10px;">
                        <a href="RESUME.docx" download class="btn btn-primary" style="padding: 0.5rem 1.5rem; font-size: 0.85rem;"><i class="fa-solid fa-download"></i> Download Resume</a>
                    </div>
                </div>
            `,
            options: [
                { text: "📁 View Projects", next: "projects" },
                { text: "⚡ Tech Skills", next: "skills" },
                { text: "🔙 Main Menu", next: "main_menu" }
            ]
        },
        contact: {
            text: "You can reach Aditya directly via email, check his GitHub projects, or connect on LinkedIn! What would you like to do?",
            options: [
                { text: "✉️ Send Email Direct", next: "email_link" },
                { text: "🔗 Open LinkedIn Profile", next: "linkedin_link" },
                { text: "🐙 View GitHub Profile", next: "github_link" },
                { text: "🔙 Main Menu", next: "main_menu" }
            ]
        },
        // Project Detail States
        proj_tnc: {
            compile: "vibecode --build TnC-Bot",
            compileOutput: `[VibeCoding] Ingesting schema... OK
[VibeCoding] Parsing PyMuPDF/Tesseract buffers... OK
[VibeCoding] Launching SQLite vector similarity engine... OK
[Success] App listening on port 8000!`,
            text: "Here is the compiled project profile for TnC-Bot:",
            rich: templates.project_tnc,
            options: [
                { text: "🚀 EXONYX", next: "proj_exonyx" },
                { text: "🛡️ Aegis AI", next: "proj_deepfake" },
                { text: "🎯 TalentLens-AI", next: "proj_talentlens" },
                { text: "📁 Other Projects", next: "projects" },
                { text: "🔙 Main Menu", next: "main_menu" }
            ]
        },
        proj_talentlens: {
            compile: "vibecode --run-eval TalentLens-AI",
            compileOutput: `[VibeCoding] Enrichment scraping GitHub profile... OK
[VibeCoding] Initializing multi-agent interview panel... OK
  \u2022 Agent Ada (Risk Evaluator): ONLINE
[Success] Assessment evaluation compiled successfully!`,
            text: "Here is the compiled project profile for TalentLens-AI:",
            rich: templates.project_talentlens,
            options: [
                { text: "🚀 EXONYX", next: "proj_exonyx" },
                { text: "🛡️ Aegis AI", next: "proj_deepfake" },
                { text: "🛡️ TnC-Bot", next: "proj_tnc" },
                { text: "📁 Other Projects", next: "projects" },
                { text: "🔙 Main Menu", next: "main_menu" }
            ]
        },
        proj_deepfake: {
            compile: "vibecode --run-inference Aegis-AI",
            compileOutput: `[VibeCoding] Loading Vision Transformer (ViT) pipeline... OK
[VibeCoding] Allocating GPU cache (AMP FP16) on CUDA... OK
[VibeCoding] Parsing MTCNN boundaries (+15% padding)... OK
[Success] Inference engine online and active!`,
            text: "Here are the details for the Aegis AI project:",
            rich: templates.project_deepfake,
            options: [
                { text: "🚀 EXONYX", next: "proj_exonyx" },
                { text: "🎯 TalentLens-AI", next: "proj_talentlens" },
                { text: "🛡️ TnC-Bot", next: "proj_tnc" },
                { text: "📁 Other Projects", next: "projects" },
                { text: "🔙 Main Menu", next: "main_menu" }
            ]
        },
        proj_exonyx: {
            compile: "vibecode --deploy EXONYX",
            compileOutput: `[VibeCoding] Compiling Next.js pages... OK
[VibeCoding] Connecting AI integration pipelines... OK
[VibeCoding] Pushing build to Vercel edge network... OK
[Success] EXONYX live on production!`,
            text: "Here is the compiled project profile for EXONYX:",
            rich: templates.project_exonyx,
            options: [
                { text: "🛡️ Aegis AI", next: "proj_deepfake" },
                { text: "🎯 TalentLens-AI", next: "proj_talentlens" },
                { text: "🛡️ TnC-Bot", next: "proj_tnc" },
                { text: "📁 Other Projects", next: "projects" },
                { text: "🔙 Main Menu", next: "main_menu" }
            ]
        }
    };

    function addMessage(text, sender, richContent = "", options = [], suppressRipple = false) {
        if (!chatHistoryLogs) return;

        if (sender === 'agent' && !suppressRipple && typeof triggerThinkingRipple === 'function') {
            triggerThinkingRipple(1.5, 0.2);
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${sender}`;
        
        // Generate current timestamp string
        const now = new Date();
        let hours = now.getHours();
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        const timeStr = `${hours}:${minutes} ${ampm}`;

        if (sender === 'agent') {
            let optionsHTML = '';
            if (options && options.length > 0) {
                optionsHTML = `<div class="chips-container">`;
                options.forEach((opt) => {
                    let icon = '';
                    const label = opt.text.toLowerCase();
                    if (label.includes('projects') || label.includes('project')) {
                        icon = '<i class="fa-regular fa-folder"></i> ';
                    } else if (label.includes('skills') || label.includes('skill') || label.includes('technical')) {
                        icon = '<i class="fa-solid fa-code"></i> ';
                    } else if (label.includes('achievements') || label.includes('milestones')) {
                        icon = '<i class="fa-solid fa-trophy"></i> ';
                    } else if (label.includes('resume')) {
                        icon = '<i class="fa-regular fa-file-lines"></i> ';
                    } else if (label.includes('say hello') || label.includes('get in touch') || label.includes('contact')) {
                        icon = '<i class="fa-regular fa-envelope"></i> ';
                    } else if (label.includes('go back') || label.includes('menu')) {
                        icon = '<i class="fa-solid fa-arrow-left"></i> ';
                    } else if (label.includes('email')) {
                        icon = '<i class="fa-regular fa-envelope"></i> ';
                    } else if (label.includes('linkedin')) {
                        icon = '<i class="fa-brands fa-linkedin-in"></i> ';
                    } else if (label.includes('github')) {
                        icon = '<i class="fa-brands fa-github"></i> ';
                    }
                    optionsHTML += `<button class="chip-btn" data-next="${opt.next}">${icon}${opt.text}</button>`;
                });
                optionsHTML += `</div>`;
            }

            messageDiv.innerHTML = `
                <div class="message-avatar">
                    <i class="fa-solid fa-brain"></i>
                </div>
                <div class="message-content">
                    <span class="message-sender">Aditya-AI Assistant</span>
                    <div class="message-bubble">
                        ${text}
                        ${richContent}
                        <span class="message-timestamp">${timeStr}</span>
                    </div>
                    ${optionsHTML}
                </div>
            `;

            // Bind click events to options
            const buttons = messageDiv.querySelectorAll('.chip-btn');
            buttons.forEach((btn, idx) => {
                const opt = options[idx];
                btn.addEventListener('click', () => {
                    // Disable all buttons in this message container to prevent repeat clicks
                    messageDiv.querySelectorAll('.chip-btn').forEach(b => b.disabled = true);
                    handleOptionClick(opt);
                });
            });

        } else {
            messageDiv.innerHTML = `
                <div class="message-content">
                    <span class="message-sender">You</span>
                    <div class="message-bubble">
                        ${escapeHTML(text)}
                        <span class="message-timestamp">${timeStr}</span>
                    </div>
                </div>
            `;
        }
        
        chatHistoryLogs.appendChild(messageDiv);
        chatHistoryLogs.scrollTop = chatHistoryLogs.scrollHeight;

        // GSAP animate bubble rise
        gsap.from(messageDiv, {
            y: 20,
            opacity: 0,
            duration: 0.35,
            ease: "power2.out",
            clearProps: "transform,opacity"
        });

        // Stagger chip button entries if they exist
        const buttons = messageDiv.querySelectorAll('.chip-btn');
        if (sender === 'agent' && buttons.length > 0) {
            gsap.from(buttons, {
                scale: 0,
                opacity: 0,
                duration: 0.4,
                delay: 0.15,
                stagger: 0.08,
                ease: "back.out(1.5)",
                clearProps: "transform,opacity"
            });
        }
    }

    function showTypingIndicator() {
        if (!chatHistoryLogs) return null;

        const indicatorDiv = document.createElement('div');
        indicatorDiv.className = 'typing-bubble chat-message agent';
        indicatorDiv.id = 'chat-typing-indicator';
        indicatorDiv.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        `;
        chatHistoryLogs.appendChild(indicatorDiv);
        chatHistoryLogs.scrollTop = chatHistoryLogs.scrollHeight;

        // GSAP animate typing indicator rise
        gsap.from(indicatorDiv, {
            y: 10,
            opacity: 0,
            duration: 0.25,
            ease: "power2.out",
            clearProps: "transform,opacity"
        });

        return indicatorDiv;
    }

    function removeTypingIndicator() {
        const indicator = document.getElementById('chat-typing-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    function handleOptionClick(optionObj) {
        addMessage(optionObj.text, 'visitor');

        // Handle direct links
        if (optionObj.next === 'email_link') {
            window.location.href = "mailto:adityajadhav300405@gmail.com";
            setTimeout(() => goToState('contact'), 500);
            return;
        }
        if (optionObj.next === 'linkedin_link') {
            window.open("https://linkedin.com", "_blank");
            setTimeout(() => goToState('contact'), 500);
            return;
        }
        if (optionObj.next === 'github_link') {
            window.open("https://github.com/Aditya-Jadhav150", "_blank");
            setTimeout(() => goToState('contact'), 500);
            return;
        }

        setTimeout(() => {
            goToState(optionObj.next);
        }, 600);
    }

    function goToState(stateKey) {
        const state = chatTree[stateKey];
        if (!state) return;

        showTypingIndicator();
        updateOnlineStatus('typing');

        const delay = state.compile ? 2200 : 1300;

        setTimeout(() => {
            removeTypingIndicator();
            updateOnlineStatus('online');

            if (state.compile) {
                const consoleDiv = document.createElement('div');
                consoleDiv.className = 'chat-inline-card';
                consoleDiv.style.fontFamily = "'Fira Code', monospace";
                consoleDiv.style.fontSize = "0.75rem";
                consoleDiv.style.background = "#0b0f19";
                consoleDiv.style.border = "1px solid rgba(255, 255, 255, 0.05)";
                consoleDiv.style.borderLeft = "3px solid var(--accent-purple)";
                consoleDiv.style.color = "#cbd5e1";
                consoleDiv.innerHTML = `
                    <div style="color:#d8b4fe; font-weight:bold; margin-bottom:4px;">&gt; ${state.compile}</div>
                    <div style="white-space:pre-line; color:#94a3b8;">${state.compileOutput}</div>
                `;
                chatHistoryLogs.appendChild(consoleDiv);
                chatHistoryLogs.scrollTop = chatHistoryLogs.scrollHeight;

                // GSAP animate inline console rise
                gsap.from(consoleDiv, {
                    y: 15,
                    opacity: 0,
                    duration: 0.3,
                    ease: "power2.out",
                    clearProps: "transform,opacity"
                });
                
                setTimeout(() => {
                    addMessage(state.text, 'agent', state.rich || "", state.options);
                }, 800);
            } else {
                addMessage(state.text, 'agent', state.rich || "", state.options);
            }

        }, delay);
    }

    function initializeChat() {
        if (!chatHistoryLogs) return;
        chatHistoryLogs.innerHTML = "";
        
        showTypingIndicator();
        updateOnlineStatus('connecting');

        setTimeout(() => {
            removeTypingIndicator();
            updateOnlineStatus('online');
            
            const state = chatTree.welcome;
            addMessage(state.text, 'agent', "", state.options, true);
            
            // Force scroll to top for the initial welcome message to prevent vertical clipping
            chatHistoryLogs.scrollTop = 0;
        }, 1200);
    }

    // Custom Text Input Event Listeners and Keyword Parser
    const chatCustomTextInput = document.getElementById('chat-custom-text-input');
    const btnChatSend = document.getElementById('btn-chat-send');
    const onlineIndicator = document.querySelector('.online-indicator');

    function updateOnlineStatus(statusType) {
        if (!onlineIndicator) return;
        if (statusType === 'typing') {
            onlineIndicator.innerHTML = `<span class="online-dot typing"></span> Aditya-AI is typing...`;
        } else if (statusType === 'connecting') {
            onlineIndicator.innerHTML = `<span class="online-dot connecting"></span> Connecting...`;
        } else {
            onlineIndicator.innerHTML = `<span class="online-dot"></span> Online`;
        }
    }

    function handleUserInput() {
        if (!chatCustomTextInput) return;
        const text = chatCustomTextInput.value.trim();
        if (!text) return;

        chatCustomTextInput.value = '';
        addMessage(text, 'visitor');
        showTypingIndicator();
        updateOnlineStatus('typing');

        setTimeout(() => {
            removeTypingIndicator();
            updateOnlineStatus('online');

            const lower = text.toLowerCase();

            if (lower.includes('project') || lower.includes('work') || lower.includes('portfolio') || lower.includes('case study')) {
                goToState('projects');
            } else if (lower.includes('skill') || lower.includes('tech') || lower.includes('stack') || lower.includes('technology') || lower.includes('language')) {
                goToState('skills');
            } else if (lower.includes('cert') || lower.includes('achievement') || lower.includes('hackathon') || lower.includes('milestone') || lower.includes('credential')) {
                goToState('certs');
            } else if (lower.includes('resume') || lower.includes('cv') || lower.includes('download')) {
                goToState('resume');
            } else if (lower.includes('contact') || lower.includes('email') || lower.includes('reach') || lower.includes('hello') || lower.includes('connect')) {
                goToState('contact');
            } else if (lower.includes('aegis') || lower.includes('deepfake') || lower.includes('synthetic')) {
                goToState('proj_deepfake');
            } else if (lower.includes('talentlens') || lower.includes('drill') || lower.includes('interview') || lower.includes('recruiter')) {
                goToState('proj_talentlens');
            } else if (lower.includes('tnc') || lower.includes('terms') || lower.includes('legal') || lower.includes('rag')) {
                goToState('proj_tnc');
            } else if (lower.includes('help') || lower.includes('options') || lower.includes('menu')) {
                goToState('main_menu');
            } else {
                addMessage(
                    "I am here to help you explore Aditya's work and experience! Select an option below or ask about his skills, projects (Aegis, TalentLens, TnC-Bot), or credentials.",
                    'agent',
                    '',
                    [
                        { text: "📁 View Projects", next: "projects" },
                        { text: "⚡ Technical Skills", next: "skills" },
                        { text: "🏆 Certifications", next: "certs" },
                        { text: "🔙 Main Menu", next: "main_menu" }
                    ]
                );
            }
        }, 1200);
    }

    if (btnChatSend) {
        btnChatSend.addEventListener('click', handleUserInput);
    }

    if (chatCustomTextInput) {
        chatCustomTextInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleUserInput();
            }
        });
    }


    /* ==========================================================================
       INTERACTIVE CONSOLE WIDGET (Experiments / Hero Section)
       ========================================================================== */
    const hiddenInput = document.getElementById('terminal-hidden-input');
    const inputDisplay = document.getElementById('terminal-input-display');
    const consoleLogs = document.getElementById('console-logs');
    const vibeConsole = document.getElementById('vibe-console');
    const livePrompt = document.getElementById('console-live-prompt');
    const terminalChips = document.querySelectorAll('.terminal-chip');

    const commands = {
        help: {
            output: `Available Commands:
  work         - View my key project case studies
  experiments  - See what I am currently exploring
  about        - Read my journey and engineering outlook
  skills       - View my tech stack matrix
  contact      - Get in touch with me
  clear        - Clear the terminal screen`,
            type: "info"
        },
        about: {
            output: `Hi, I'm Aditya Jadhav. I'm an IT student at Maturi Venkata Subba Rao Engineering College, Hyderabad.
I build tools at the intersection of Machine Learning, Android Accessibility, and clean editorial web design.
I'm inspired by high-quality design, clean interfaces, and fast prototyping.
Practitioner of VibeCoding — utilizing advanced AI tools to engineer robust software solutions.`,
            type: "info"
        },
        work: {
            output: `Core Projects:
  1. Aegis AI (Deep Learning / Synthetic Media Detection)
  2. Placement Interview Drill Bot (Next.js / Multi-Agent Simulation)
  3. TnC-Bot (Vector RAG legal clauses interpreter)
  4. EXONYX (Full-Stack AI Application)

Type 'work 1' through 'work 4' (e.g. 'work 1') to inspect a project.`,
            type: "info"
        },
        "work 1": {
            output: `[01 / Aegis AI]
• Category: Deep Learning / Synthetic Media Detection
• Tech: Python, PyTorch, Flask, SQLite, Hugging Face
• Description: Full-stack deepfake classification app pairing a HF Vision Transformer (ViT) model, custom face-extraction alignments, and Google OAuth user frameworks.
• Impact: Achieved precision detections on GAN/Diffusion synthetic faces.`,
            type: "success"
        },
        "work 2": {
            output: `[02 / Placement Interview Drill Bot]
• Category: Multi-Agent AI / Assessment Tools
• Tech: Next.js, TypeScript, FastAPI, OpenAI API, Clerk Auth
• Description: Multi-agent assessment simulation with distinct interviewer profiles (including cynical risk evaluator Agent Ada) to stress-test candidates.
• Impact: Led to 35% higher confidence scores in mock interview trials.`,
            type: "success"
        },
        "work 3": {
            output: `[03 / TnC-Bot]
• Category: Semantic RAG / Hybrid Systems
• Tech: FastAPI, React, SQLite, Android Studio, Chrome APIs
• Description: Document Ingestion engine using vector similarity search, Chrome extension scraping, and Android overlays to translate legalese into plain text warnings.
• Impact: Flags high-risk clauses in 10+ page agreements with 94% accuracy.`,
            type: "success"
        },
        "work 4": {
            output: `[04 / EXONYX]
• Category: Full-Stack AI Application
• Tech: Next.js, React, AI/ML, Vercel
• Description: A high-performance modern web application integrating advanced AI workflows to streamline digital processes.
• Impact: Deployed seamlessly on Vercel with a responsive Next.js frontend architecture.`,
            type: "success"
        },
        experiments: {
            output: `Things I'm Exploring:
  • Machine Learning & Deep Learning: Custom convolutional nets, weights optimization, and model regularization.
  • AI Agents & Workflows: Multi-agent systems with specialized personas cooperating dynamically.
  • NVIDIA GPU Acceleration: CUDA pipelines, PyTorch Automatic Mixed Precision (AMP), and CUDNN optimizations.
  • Full Stack Architectures: Building responsive Flask/FastAPI servers and SQL relational tables.
  • Chrome Extension APIs: Creating secure browser automation wrappers under Manifest V3.`,
            type: "info"
        },
        skills: {
            output: `Technical Skills Matrix:
  [Languages]   Python, SQL, JavaScript, C, Java
  [Web Stack]   React, Next.js, FastAPI, HTML5, CSS3
  [ML & AI]     TensorFlow, PyTorch, CNNs, RAG, Computer Vision
  [Databases]   MySQL, SQLite
  [Dev Tools]   Git, VS Code, Docker, Android Studio, Chrome APIs`,
            type: "info"
        },
        contact: {
            output: `Contact Channels:
  • Email:    adityajadhav300405@gmail.com
  • GitHub:   https://github.com/Aditya-Jadhav150
  • LinkedIn: https://linkedin.com`,
            type: "info"
        }
    };

    function executeTerminalCommand(cmdString) {
        if (!consoleLogs || !livePrompt) return;

        let lookup = cmdString.trim().toLowerCase();
        
        // Aliases and mappings
        if (lookup === 'projects') lookup = 'work';
        if (lookup === 'clear') {
            const lines = consoleLogs.querySelectorAll('.console-line:not(#console-live-prompt)');
            lines.forEach(l => l.remove());
            return;
        }

        // Project alias mappings
        if (['work 1', 'work1', 'project 1', 'project1'].includes(lookup)) lookup = 'work 1';
        if (['work 2', 'work2', 'project 2', 'project2'].includes(lookup)) lookup = 'work 2';
        if (['work 3', 'work3', 'project 3', 'project3'].includes(lookup)) lookup = 'work 3';
        if (['work 4', 'work4', 'project 4', 'project4'].includes(lookup)) lookup = 'work 4';
        
        if (['skill', 'skills'].includes(lookup)) lookup = 'skills';
        if (['about', 'bio'].includes(lookup)) lookup = 'about';
        if (['contact', 'email', 'social'].includes(lookup)) lookup = 'contact';
        if (['experiments', 'exploration', 'explorations'].includes(lookup)) lookup = 'experiments';

        const outputDiv = document.createElement('div');
        outputDiv.className = 'console-line';

        if (commands[lookup]) {
            const outputText = commands[lookup].output;
            const outputType = commands[lookup].type;
            outputDiv.innerHTML = `<div class="console-output ${outputType}">${outputText}</div>`;
        } else {
            outputDiv.innerHTML = `<div class="console-output warning">Command not found: '${cmdString}'. Type 'help' to see valid commands.</div>`;
        }

        consoleLogs.insertBefore(outputDiv, livePrompt);
    }

    // Capture click to focus hidden input
    if (vibeConsole && hiddenInput) {
        vibeConsole.addEventListener('click', () => {
            hiddenInput.focus();
        });
    }

    // Bind real-time input echo and execution
    if (hiddenInput && inputDisplay) {
        hiddenInput.addEventListener('input', (e) => {
            inputDisplay.textContent = e.target.value;
        });

        hiddenInput.addEventListener('keydown', (e) => {
            if (typeof window.triggerNeuralKeystrokePulse === 'function') {
                window.triggerNeuralKeystrokePulse();
            }
            if (e.key === 'Enter') {
                const rawCmd = hiddenInput.value;
                
                // Echo the prompt command first
                const cmdLine = document.createElement('div');
                cmdLine.className = 'console-line';
                cmdLine.innerHTML = `<div class="console-prompt">visitor@aditya:~$ <span>${escapeHTML(rawCmd)}</span></div>`;
                consoleLogs.insertBefore(cmdLine, livePrompt);

                // Execute command
                if (rawCmd.trim()) {
                    executeTerminalCommand(rawCmd);
                }

                // Reset input
                hiddenInput.value = "";
                inputDisplay.textContent = "";
                consoleLogs.scrollTop = consoleLogs.scrollHeight;
            }
        });
    }

    // Bind quick chips click behaviors
    terminalChips.forEach(chip => {
        chip.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent focus event bubblings
            const cmd = chip.getAttribute('data-cmd');
            if (hiddenInput && inputDisplay) {
                let charIndex = 0;
                hiddenInput.value = "";
                inputDisplay.textContent = "";
                hiddenInput.focus();

                const typingInterval = setInterval(() => {
                    hiddenInput.value += cmd[charIndex];
                    inputDisplay.textContent += cmd[charIndex];
                    charIndex++;

                    if (typeof window.triggerNeuralKeystrokePulse === 'function') {
                        window.triggerNeuralKeystrokePulse();
                    }

                    if (charIndex === cmd.length) {
                        clearInterval(typingInterval);
                        setTimeout(() => {
                            // Run command
                            const rawCmd = hiddenInput.value;
                            const cmdLine = document.createElement('div');
                            cmdLine.className = 'console-line';
                            cmdLine.innerHTML = `<div class="console-prompt">visitor@aditya:~$ <span>${escapeHTML(rawCmd)}</span></div>`;
                            consoleLogs.insertBefore(cmdLine, livePrompt);

                            executeTerminalCommand(rawCmd);

                            hiddenInput.value = "";
                            inputDisplay.textContent = "";
                            consoleLogs.scrollTop = consoleLogs.scrollHeight;
                        }, 250);
                    }
                }, 50);
            }
        });
    });


    /* ==========================================================================
       SCROLL REVEAL OBSERVER
       ========================================================================== */
    const revealElements = document.querySelectorAll('.reveal');

    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: "0px 0px -50px 0px"
    });

    revealElements.forEach(el => revealObserver.observe(el));


    /* ==========================================================================
       ACTIVE NAV LINK ON SCROLL
       ========================================================================== */
    const sections = document.querySelectorAll('section');
    const navLinks = document.querySelectorAll('.nav-links a');

    window.addEventListener('scroll', () => {
        if (detailPageActive) return;
        let current = "";
        
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.clientHeight;
            if (window.scrollY >= (sectionTop - 250)) {
                current = section.getAttribute('id');
            }
        });

        // Map hero to work/home or let it be neutral
        if (current === 'hero') current = '';

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href').substring(1) === current) {
                link.classList.add('active');
            }
        });
    });


    /* ==========================================================================
       CONTACT FORM SUCCESS INTERACTION (Web3Forms API)
       ========================================================================== */
    const contactForm = document.getElementById('portfolio-contact-form');
    const formSuccess = document.getElementById('form-success');
    const submitBtn = document.getElementById('btn-submit-contact');

    if (contactForm && formSuccess && submitBtn) {
        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            submitBtn.disabled = true;
            const originalText = submitBtn.innerHTML;
            submitBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Sending...`;

            // Prepare form data for Web3Forms
            const formData = new FormData(contactForm);
            // Required to return JSON instead of redirecting
            formData.append("replyto", document.getElementById('form-email').value);

            try {
                const response = await fetch('https://api.web3forms.com/submit', {
                    method: 'POST',
                    body: formData,
                    headers: {
                        'Accept': 'application/json'
                    }
                });
                
                const result = await response.json();

                if (response.status === 200) {
                    // Show success UI
                    contactForm.style.display = 'none';
                    formSuccess.style.display = 'flex';
                    formSuccess.style.opacity = '0';
                    
                    setTimeout(() => {
                        formSuccess.style.transition = 'opacity 0.5s ease';
                        formSuccess.style.opacity = '1';
                    }, 50);

                    contactForm.reset();
                } else {
                    console.error("Web3Forms Error:", result);
                    alert("Oops! Something went wrong: " + result.message);
                }
            } catch (error) {
                console.error("Fetch error:", error);
                alert("Something went wrong. Please check your internet connection and try again.");
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }
        });
    }

    /* ==========================================================================
       SINGLE PAGE ROUTING & PARALLAX SCROLL FOR CASE STUDIES
       ========================================================================== */
    const homeView = document.getElementById('home-view');
    const projectDetailView = document.getElementById('project-detail-view');
    const btnBackHome = document.getElementById('btn-back-home');
    const exploreButtons = document.querySelectorAll('.explore-project-btn');
    
    // Project cover elements
    const coverContainer = document.getElementById('project-cover-container');
    const coverBg = document.getElementById('detail-cover-bg');
    
    // Detail content elements
    const detailNum = document.getElementById('detail-number');
    const detailTitle = document.getElementById('detail-title');
    const detailCategory = document.getElementById('detail-category');
    const detailSpecRole = document.getElementById('detail-spec-role');
    const detailSpecTimeline = document.getElementById('detail-spec-timeline');
    const detailSpecFocus = document.getElementById('detail-spec-focus');
    const detailNarrativeContainer = document.getElementById('detail-narrative-container');
    const detailHeader = document.getElementById('detail-header');

    // Keep track of scroll positions
    let homeScrollPosition = 0;
    let detailPageActive = false;

    // Detailed project data model
    const projectDetailsData = {
        aegis: {
            num: "01 /",
            title: "Aegis AI",
            category: "Deep Learning / Synthetic Media Detection",
            role: "Lead Developer",
            timeline: "2026 (Ongoing)",
            focus: "Transformer Inference",
            gradientClass: "aegis-gradient",
            narrative: `
                <div class="detail-block">
                    <h4>The Problem</h4>
                    <p>The exponential growth of sophisticated generative AI and diffusion pipelines (like Midjourney and Latent Diffusion) has made synthetic media virtually indistinguishable from authentic photos, presenting severe security, identity, and misinformation risks.</p>
                </div>
                <div class="detail-block">
                    <h4>The Solution</h4>
                    <p>A secure production-grade deepfake detection platform featuring a Flask full-stack runtime, SQLite database persistence, and a Hugging Face Vision Transformer (ViT) inference engine. Incorporates a custom local training workflow utilizing an EfficientNet-B3 network with Mixup regularization.</p>
                </div>
                <div class="detail-block">
                    <h4>Key Architecture Features</h4>
                    <ul>
                        <li>Pre-trained Vision Transformer model orchestration using Hugging Face AutoImageProcessor and AutoModel pipelines.</li>
                        <li>Local dataset preparation of 30,000 synthetic faces with custom Mixup regularization to smooth neural decision boundaries during training.</li>
                        <li>Automated MTCNN face alignment that expands bounding coordinates by 15% to capture jawline and hairline seams where diffusion artifacts typically manifest.</li>
                        <li>Advanced account security mechanisms including an in-memory IP jail rate-limiter, Google OAuth SSO integration, and 7-day username change restrictions.</li>
                    </ul>
                </div>
                <div class="detail-block">
                    <h4>Technologies Employed</h4>
                    <div class="detail-tech-list">
                        <span class="detail-tech-tag">Python</span>
                        <span class="detail-tech-tag">PyTorch</span>
                        <span class="detail-tech-tag">Flask</span>
                        <span class="detail-tech-tag">SQLite</span>
                        <span class="detail-tech-tag">Hugging Face</span>
                    </div>
                </div>
                <div class="detail-block">
                    <h4>Outcome & Metrics</h4>
                    <p>Delivered highly precise classification on GAN/Diffusion fakes, resolving phone EXIF image rotation issues automatically and securing authentication endpoints against credential stuffing.</p>
                    <div class="detail-outcome-box">
                        <p style="font-weight: 700; color: #ffffff; font-size: 1.1rem; margin-top: 10px;">98.4% Classification Accuracy on Latent Diffusion sets</p>
                    </div>
                </div>
            `
        },
        "interview-bot": {
            num: "02 /",
            title: "Interview Drill Bot",
            category: "Multi-Agent AI / Assessment Tools",
            role: "System Architect",
            timeline: "2026",
            focus: "Multi-Agent Panel",
            gradientClass: "talentlens-gradient",
            narrative: `
                <div class="detail-block">
                    <h4>The Problem</h4>
                    <p>Undergraduates often face intense performance anxiety and lack access to mock evaluation environments, leading to preparation gaps during competitive campus recruitment drives.</p>
                </div>
                <div class="detail-block">
                    <h4>The Solution</h4>
                    <p>An AI-driven recruiter simulation dashboard built with Next.js and FastAPI. It extracts real-time signals from candidates' GitHub/LinkedIn profiles, maps them to job description requirements, and spins up a multi-agent panel to conduct interactive voice/text technical drills.</p>
                </div>
                <div class="detail-block">
                    <h4>Key Architecture Features</h4>
                    <ul>
                        <li>Interactive simulation panel containing agent profiles with distinct interview personas.</li>
                        <li>Agent Ada (Risk Evaluator): A cynical evaluator agent designed to challenge developer decisions and test resilience under technical stress.</li>
                        <li>Enrichment scraping pipelines running via bright web scraping APIs (Bright Data, Microlink) to verify candidate contributions.</li>
                        <li>Predictive diagnostic output generating skill gap scoring and personalized placement trajectory paths.</li>
                    </ul>
                </div>
                <div class="detail-block">
                    <h4>Technologies Employed</h4>
                    <div class="detail-tech-list">
                        <span class="detail-tech-tag">Next.js</span>
                        <span class="detail-tech-tag">TypeScript</span>
                        <span class="detail-tech-tag">FastAPI</span>
                        <span class="detail-tech-tag">OpenAI API</span>
                        <span class="detail-tech-tag">Clerk Auth</span>
                    </div>
                </div>
                <div class="detail-block">
                    <h4>Outcome & Metrics</h4>
                    <p>Tested across a sample student group, yielding a 35% self-reported increase in campus placement interview confidence and 20% higher scores in subsequent technical mock rounds.</p>
                    <div class="detail-outcome-box">
                        <p style="font-weight: 700; color: #ffffff; font-size: 1.1rem; margin-top: 10px;">35% Increase in Confidence & 20% Mock Score Gains</p>
                    </div>
                </div>
            `
        },
        "tnc-bot": {
            num: "03 /",
            title: "TnC-Bot",
            category: "Semantic RAG / Hybrid Systems",
            role: "Full Stack Dev",
            timeline: "2026",
            focus: "Local RAG Vector Ingestion",
            gradientClass: "tnc-gradient",
            narrative: `
                <div class="detail-block">
                    <h4>The Problem</h4>
                    <p>End-users blindly agree to dense Terms and Conditions legal documents, exposing themselves to hidden privacy concerns and data monetization disclosures due to complex legalese.</p>
                </div>
                <div class="detail-block">
                    <h4>The Solution</h4>
                    <p>A multi-platform semantic agent running on React, FastAPI, and SQLite. Ingests terms agreements via OCR, indexes them into a local vector embeddings database, and translates legal clauses into readable warning flags.</p>
                </div>
                <div class="detail-block">
                    <h4>Key Architecture Features</h4>
                    <ul>
                        <li>Manifest V3 Chrome Extension and Java Android Accessibility service for background webpage scraping.</li>
                        <li>Document ingestion system utilizing PyMuPDF and Tesseract OCR for text retrieval.</li>
                        <li>Local RAG similarity lookup and cosine search queries on mobile-friendly SQLite stores.</li>
                        <li>Multi-mode translation engine converting legalese into Simple, Teen, and Technical mode summaries.</li>
                    </ul>
                </div>
                <div class="detail-block">
                    <h4>Technologies Employed</h4>
                    <div class="detail-tech-list">
                        <span class="detail-tech-tag">FastAPI</span>
                        <span class="detail-tech-tag">React</span>
                        <span class="detail-tech-tag">SQLite</span>
                        <span class="detail-tech-tag">Android Studio</span>
                        <span class="detail-tech-tag">Chrome APIs</span>
                    </div>
                </div>
                <div class="detail-block">
                    <h4>Outcome & Metrics</h4>
                    <p>Processes complex 10+ page corporate privacy policies in under 60 seconds, flagging high-risk clauses with 94% semantic accuracy to protect digital users.</p>
                    <div class="detail-outcome-box">
                        <p style="font-weight: 700; color: #ffffff; font-size: 1.1rem; margin-top: 10px;">94% Clause Risk Classification Precision</p>
                    </div>
                </div>
            `
        },
        exonyx: {
            num: "04 /",
            title: "EXONYX",
            category: "Full-Stack AI Application",
            role: "Lead Developer",
            timeline: "2026",
            focus: "Web Integration",
            gradientClass: "aegis-gradient",
            narrative: `
                <div class="detail-block">
                    <h4>The Project</h4>
                    <p>A high-performance modern web application integrating advanced AI workflows to streamline digital processes. Developed to provide robust functionality combined with seamless user interactions.</p>
                </div>
                <div class="detail-block">
                    <h4>Key Architecture Features</h4>
                    <ul>
                        <li>Seamless full-stack integration deployed on Vercel for edge network performance.</li>
                        <li>Dynamic, responsive frontend architecture built using Next.js and React.</li>
                        <li>Integration of AI/ML services for enhanced data processing.</li>
                        <li>Optimized for speed, accessibility, and modern web standards.</li>
                    </ul>
                </div>
                <div class="detail-block">
                    <h4>Technologies Employed</h4>
                    <div class="detail-tech-list">
                        <span class="detail-tech-tag">Next.js</span>
                        <span class="detail-tech-tag">React</span>
                        <span class="detail-tech-tag">AI/ML</span>
                        <span class="detail-tech-tag">Vercel</span>
                    </div>
                </div>
                <div class="detail-block">
                    <h4>Outcome & Metrics</h4>
                    <p>Successfully shipped a stable production build to Vercel, ensuring high uptime, rapid edge delivery, and scalable infrastructure.</p>
                    <div class="detail-outcome-box">
                        <p style="font-weight: 700; color: #ffffff; font-size: 1.1rem; margin-top: 10px;">Successfully Deployed & Scaled on Vercel Edge</p>
                    </div>
                </div>
            `
        }
    };

    function showProjectDetail(projectKey) {
        const data = projectDetailsData[projectKey];
        if (!data) return;

        // Save home scroll
        homeScrollPosition = window.scrollY;
        detailPageActive = true;

        // Populate detail content
        detailNum.textContent = data.num;
        detailTitle.textContent = data.title;
        detailCategory.textContent = data.category;
        detailSpecRole.textContent = data.role;
        detailSpecTimeline.textContent = data.timeline;
        detailSpecFocus.textContent = data.focus;
        detailNarrativeContainer.innerHTML = data.narrative;
        
        // Setup Cover bg gradient class
        coverBg.className = 'project-cover-bg ' + data.gradientClass;

        // Reset cover transform styles
        coverContainer.style.transform = 'scale(1)';
        coverContainer.style.borderRadius = '0px';
        coverContainer.style.opacity = '1';
        coverContainer.style.visibility = 'visible';

        // Hide home view, show detail view
        homeView.classList.add('fade-out');
        
        setTimeout(() => {
            homeView.classList.add('hidden');
            projectDetailView.classList.remove('hidden');
            window.scrollTo(0, 0);
            
            // Trigger detail fade-in
            setTimeout(() => {
                projectDetailView.classList.add('fade-in');
            }, 50);
        }, 500);
    }

    function returnToHome() {
        detailPageActive = false;
        projectDetailView.classList.remove('fade-in');
        
        setTimeout(() => {
            projectDetailView.classList.add('hidden');
            homeView.classList.remove('hidden');
            
            // Restore scroll position
            window.scrollTo(0, homeScrollPosition);
            
            setTimeout(() => {
                homeView.classList.remove('fade-out');
            }, 50);
        }, 500);
    }

    // Bind explore project clicks
    exploreButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const projectKey = btn.getAttribute('data-project');
            showProjectDetail(projectKey);
        });
    });

    // Bind back home click
    if (btnBackHome) {
        btnBackHome.addEventListener('click', () => {
            returnToHome();
        });
    }

    // Scroll parallax shrink logic
    window.addEventListener('scroll', () => {
        if (!detailPageActive) return;

        const scrollY = window.scrollY;
        const viewportHeight = window.innerHeight;
        
        // Calculate scroll ratio relative to viewport
        const ratio = Math.min(scrollY / viewportHeight, 1);
        
        // Cover container scales from 1.0 down to 0.85
        const scale = 1 - (ratio * 0.15);
        
        // Add border radius up to 24px as we shrink
        const radius = ratio * 24;
        
        // Subtle vertical translation to add depth
        const translate = -ratio * 50;

        coverContainer.style.transform = `scale(${scale}) translateY(${translate}px)`;
        coverContainer.style.borderRadius = `${radius}px`;

        // Fade out the entire cover container as we scroll past it to keep the background clean
        coverContainer.style.opacity = 1 - ratio;
        coverContainer.style.visibility = ratio === 1 ? 'hidden' : 'visible';

        // Fade detail cover text as we scroll
        const coverInner = document.querySelector('.project-cover-inner');
        if (coverInner) {
            coverInner.style.opacity = 1 - ratio * 1.5;
        }

        // Header background transition on scroll
        if (scrollY > 50) {
            detailHeader.classList.add('scrolled');
        } else {
            detailHeader.classList.remove('scrolled');
        }
    });

});
