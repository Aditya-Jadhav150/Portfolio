(function () {
    // Immersion Layer: Neural Network Background Cursor
    const canvas = document.getElementById('neural-background-canvas');
    if (!canvas) return;

    let scene, camera, renderer;
    let nodes = [];
    let synapses = [];
    let packets = [];
    let clickRipples = [];

    // Configuration
    const IS_MOBILE = window.innerWidth < 768;
    const NODE_COUNT = IS_MOBILE ? 50 : 110;
    const MAX_CONNECTIONS = 3;
    const SYNAPSE_MAX_DIST = IS_MOBILE ? 2.2 : 2.8;
    const PACKET_SPEED = 1.8;
    const ATTRACT_SPEED = 0.08;

    // Stimulus and Idle tracking
    let mouse = { x: 0, y: 0, targetX: 0, targetY: 0, active: false };
    let mouse3D = new THREE.Vector3(0, 0, 0);
    let lastInteractionTime = Date.now();
    let isIdle = false;

    // Hover Elements
    let hoveredCard = null;
    let hoveredNavLink = null;
    let hoveredChatButton = false;

    // Section awareness
    let activeSection = 'hero'; // 'hero' | 'work' | 'experiments' | 'about' | 'contact'
    let sectionTransitionTimer = 0;  // counts down after entering a new section
    let tempSynapses = []; // dynamically created/destroyed synapses for 'experiments' mode

    // Helper: Dynamic particle textures
    function createCircleTexture(color = '#ffffff', size = 32) {
        const texCanvas = document.createElement('canvas');
        texCanvas.width = size;
        texCanvas.height = size;
        const ctx = texCanvas.getContext('2d');
        const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
        grad.addColorStop(0, color);
        grad.addColorStop(0.3, color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        return new THREE.CanvasTexture(texCanvas);
    }

    // Initialize WebGL Scene
    function init() {
        scene = new THREE.Scene();

        camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
        camera.position.set(0, 0, 10);

        renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            alpha: true,
            antialias: !IS_MOBILE,
            powerPreference: "high-performance"
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);

        initGraph();
        setupMeshes();
        bindEvents();

        // Start animation loop
        requestAnimationFrame(animate);
    }

    // Coordinates projection (screen to world at Z=0)
    function screenToWorld(clientX, clientY, targetZ = 0) {
        const vec = new THREE.Vector3(
            (clientX / window.innerWidth) * 2 - 1,
            -(clientY / window.innerHeight) * 2 + 1,
            0.5
        );
        vec.unproject(camera);
        vec.sub(camera.position).normalize();
        const distance = (targetZ - camera.position.z) / vec.z;
        return camera.position.clone().add(vec.multiplyScalar(distance));
    }

    // Construct the neural network graph
    function initGraph() {
        const aspect = window.innerWidth / window.innerHeight;
        const heightLimit = 10 * Math.tan((camera.fov * Math.PI) / 360);
        const widthLimit = heightLimit * aspect;

        // 1. Generate Nodes
        for (let i = 0; i < NODE_COUNT; i++) {
            // Position nodes randomly in 3D box representing viewport
            const x = (Math.random() - 0.5) * widthLimit * 1.9;
            const y = (Math.random() - 0.5) * heightLimit * 1.9;
            const z = (Math.random() - 0.5) * 2.0;

            const baseColor = new THREE.Color();
            // Sophisticated HSL colors matching cyan/blue/white accents
            const rand = Math.random();
            if (rand < 0.45) {
                baseColor.setHSL(0.52, 0.9, 0.6); // Slate blue / Cyan
            } else if (rand < 0.8) {
                baseColor.setHSL(0.55, 0.8, 0.5); // Rich blue
            } else {
                baseColor.setRGB(1.0, 1.0, 1.0); // Clean white
            }

            nodes.push({
                id: i,
                position: new THREE.Vector3(x, y, z),
                basePosition: new THREE.Vector3(x, y, z),
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.15,
                    (Math.random() - 0.5) * 0.15,
                    (Math.random() - 0.5) * 0.05
                ),
                phaseX: Math.random() * Math.PI * 2,
                phaseY: Math.random() * Math.PI * 2,
                activation: 0.15,
                targetActivation: 0.15,
                size: Math.random() * 0.07 + 0.045,
                color: baseColor,
                neighbors: [],
                hoverTarget: null
            });
        }

        // 2. Establish connections (Synapses)
        for (let i = 0; i < nodes.length; i++) {
            const nodeA = nodes[i];
            const distances = [];

            for (let j = 0; j < nodes.length; j++) {
                if (i === j) continue;
                const d = nodeA.position.distanceTo(nodes[j].position);
                if (d < SYNAPSE_MAX_DIST) {
                    distances.push({ index: j, dist: d });
                }
            }

            // Connect nearest nodes to form a clean, non-tangled mesh
            distances.sort((a, b) => a.dist - b.dist);
            const numConns = Math.min(distances.length, MAX_CONNECTIONS);
            for (let k = 0; k < numConns; k++) {
                const neighborIdx = distances[k].index;

                if (!nodeA.neighbors.includes(neighborIdx)) {
                    nodeA.neighbors.push(neighborIdx);
                }
                if (!nodes[neighborIdx].neighbors.includes(i)) {
                    nodes[neighborIdx].neighbors.push(i);
                }

                // Create synapse representation (only one connection line between two nodes)
                if (i < neighborIdx) {
                    synapses.push({
                        from: i,
                        to: neighborIdx,
                        baseWeight: 0.08 + (1 - distances[k].dist / SYNAPSE_MAX_DIST) * 0.25,
                        weight: 0.08,
                        color: nodeA.color.clone().lerp(nodes[neighborIdx].color, 0.5),
                        pulseIntensity: 0.0
                    });
                }
            }
        }
    }

    // Set up BufferGeometries and Points/Lines systems
    let pointsGeometry, lineGeometry, linePositions, lineColors;
    let pointsMesh, linesMesh;

    let packetGeometry, packetPositions, packetColors, packetSizes;
    let packetsMesh;
    const MAX_PACKETS = 160;

    function setupMeshes() {
        // --- 1. Nodes Mesh ---
        pointsGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(NODE_COUNT * 3);
        const colors = new Float32Array(NODE_COUNT * 3);
        const sizes = new Float32Array(NODE_COUNT);

        nodes.forEach((node, idx) => {
            positions[idx * 3] = node.position.x;
            positions[idx * 3 + 1] = node.position.y;
            positions[idx * 3 + 2] = node.position.z;

            colors[idx * 3] = node.color.r;
            colors[idx * 3 + 1] = node.color.g;
            colors[idx * 3 + 2] = node.color.b;

            sizes[idx] = node.size;
        });

        pointsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        pointsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        pointsGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        // Point Shader: glow particle with custom size scaling
        const pointsMaterial = new THREE.ShaderMaterial({
            uniforms: {
                pointTexture: { value: createCircleTexture('#ffffff', 32) }
            },
            vertexShader: `
                attribute float size;
                varying vec3 vColor;
                void main() {
                    vColor = color;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (320.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D pointTexture;
                varying vec3 vColor;
                void main() {
                    gl_FragColor = vec4(vColor, 1.0) * texture2D(pointTexture, gl_PointCoord);
                }
            `,
            transparent: true,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        pointsMesh = new THREE.Points(pointsGeometry, pointsMaterial);
        scene.add(pointsMesh);

        // --- 2. Synapses (Lines) Mesh ---
        lineGeometry = new THREE.BufferGeometry();
        linePositions = new Float32Array(synapses.length * 2 * 3);
        lineColors = new Float32Array(synapses.length * 2 * 3);

        synapses.forEach((syn, idx) => {
            const nodeA = nodes[syn.from];
            const nodeB = nodes[syn.to];

            linePositions[idx * 6] = nodeA.position.x;
            linePositions[idx * 6 + 1] = nodeA.position.y;
            linePositions[idx * 6 + 2] = nodeA.position.z;

            linePositions[idx * 6 + 3] = nodeB.position.x;
            linePositions[idx * 6 + 4] = nodeB.position.y;
            linePositions[idx * 6 + 5] = nodeB.position.z;

            // Compute brightness based on initial weights
            const factor = syn.weight;
            lineColors[idx * 6] = syn.color.r * factor;
            lineColors[idx * 6 + 1] = syn.color.g * factor;
            lineColors[idx * 6 + 2] = syn.color.b * factor;

            lineColors[idx * 6 + 3] = syn.color.r * factor;
            lineColors[idx * 6 + 4] = syn.color.g * factor;
            lineColors[idx * 6 + 5] = syn.color.b * factor;
        });

        lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
        lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

        const linesMaterial = new THREE.LineBasicMaterial({
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false
        });

        linesMesh = new THREE.LineSegments(lineGeometry, linesMaterial);
        scene.add(linesMesh);

        // --- 3. Data Packets Mesh ---
        packetGeometry = new THREE.BufferGeometry();
        packetPositions = new Float32Array(MAX_PACKETS * 3);
        packetColors = new Float32Array(MAX_PACKETS * 3);
        packetSizes = new Float32Array(MAX_PACKETS);

        // Place packets offscreen initially
        for (let i = 0; i < MAX_PACKETS; i++) {
            packetPositions[i * 3] = 9999;
            packetPositions[i * 3 + 1] = 9999;
            packetPositions[i * 3 + 2] = 0;
            packetColors[i * 3] = 0;
            packetColors[i * 3 + 1] = 0;
            packetColors[i * 3 + 2] = 0;
            packetSizes[i] = 0.0;
        }

        packetGeometry.setAttribute('position', new THREE.BufferAttribute(packetPositions, 3));
        packetGeometry.setAttribute('color', new THREE.BufferAttribute(packetColors, 3));
        packetGeometry.setAttribute('size', new THREE.BufferAttribute(packetSizes, 1));

        const packetTexture = createCircleTexture('#ffffff', 32);
        const packetsMaterial = new THREE.ShaderMaterial({
            uniforms: {
                pointTexture: { value: packetTexture }
            },
            vertexShader: `
                attribute float size;
                varying vec3 vColor;
                void main() {
                    vColor = color;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (320.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D pointTexture;
                varying vec3 vColor;
                void main() {
                    gl_FragColor = vec4(vColor, 1.0) * texture2D(pointTexture, gl_PointCoord);
                }
            `,
            transparent: true,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        packetsMesh = new THREE.Points(packetGeometry, packetsMaterial);
        scene.add(packetsMesh);
    }

    // Packet Spawning Helper (using pooled arrays)
    function spawnPacket(fromNode, toNode, colorHex = 0x22d3ee, size = 0.065, speed = PACKET_SPEED, route = null) {
        let slot = packets.find(p => p.free);
        if (!slot) {
            if (packets.length < MAX_PACKETS) {
                slot = { free: true };
                packets.push(slot);
            } else {
                // Steal oldest active slot
                slot = packets.sort((a, b) => a.spawnTime - b.spawnTime)[0];
            }
        }

        slot.free = false;
        slot.spawnTime = Date.now();
        slot.fromNode = fromNode;
        slot.toNode = toNode;
        slot.progress = 0.0;
        slot.speed = speed * (0.85 + Math.random() * 0.3);
        slot.color = new THREE.Color(colorHex);
        slot.size = size;
        slot.route = route;
        slot.routeIndex = 0;
    }

    // Dijkstra/BFS for shortest path routing
    function findShortestPath(startIdx, endIdx) {
        if (startIdx === endIdx) return [startIdx];

        const queue = [[startIdx]];
        const visited = new Set();
        visited.add(startIdx);

        while (queue.length > 0) {
            const path = queue.shift();
            const currNode = path[path.length - 1];

            if (currNode === endIdx) {
                return path;
            }

            const neighbors = nodes[currNode].neighbors;
            for (let i = 0; i < neighbors.length; i++) {
                const n = neighbors[i];
                if (!visited.has(n)) {
                    visited.add(n);
                    queue.push([...path, n]);
                }
            }
        }
        return null; // unreachable
    }

    // Unproject element coordinates to world 3D boundaries
    function getElement3DBounds(element) {
        const rect = element.getBoundingClientRect();
        const tl = screenToWorld(rect.left, rect.top);
        const br = screenToWorld(rect.right, rect.bottom);

        return {
            xMin: Math.min(tl.x, br.x),
            xMax: Math.max(tl.x, br.x),
            yMin: Math.min(tl.y, br.y),
            yMax: Math.max(tl.y, br.y),
            center: new THREE.Vector3((tl.x + br.x) / 2, (tl.y + br.y) / 2, 0),
            width: Math.abs(tl.x - br.x),
            height: Math.abs(tl.y - br.y)
        };
    }

    // Route a pulse sequence along a DOM element path
    function triggerRouteToElement(element) {
        const bounds = getElement3DBounds(element);
        const targetNodeIdx = findClosestNodeIndex(bounds.center);
        const mouseNodeIdx = findClosestNodeIndex(mouse3D);

        if (targetNodeIdx !== -1 && mouseNodeIdx !== -1) {
            const path = findShortestPath(mouseNodeIdx, targetNodeIdx);
            if (path && path.length > 1) {
                // Light up route synapses
                for (let i = 0; i < path.length - 1; i++) {
                    const syn = findSynapse(path[i], path[i+1]);
                    if (syn) {
                        syn.pulseIntensity = 1.0;
                    }
                }
                // Spawn sequential packet on path
                spawnPacket(path[0], path[1], 0xffffff, 0.08, PACKET_SPEED * 1.3, path);
            }
        }
    }

    // Helper: Find closest node to 3D point
    function findClosestNodeIndex(pos3D) {
        let minDist = Infinity;
        let index = -1;
        for (let i = 0; i < nodes.length; i++) {
            const d = nodes[i].position.distanceTo(pos3D);
            if (d < minDist) {
                minDist = d;
                index = i;
            }
        }
        return index;
    }

    // Helper: Find synapse connecting two node IDs
    function findSynapse(idA, idB) {
        const minId = Math.min(idA, idB);
        const maxId = Math.max(idA, idB);
        return synapses.find(s => s.from === minId && s.to === maxId);
    }

    // Bind event listeners (clicks, mouse, typing, resize)
    function bindEvents() {
        window.addEventListener('mousemove', (e) => {
            mouse.clientX = e.clientX;
            mouse.clientY = e.clientY;
            mouse.targetX = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.targetY = -(e.clientY / window.innerHeight) * 2 + 1;
            mouse.active = true;
            lastInteractionTime = Date.now();
            isIdle = false;
        });

        // Trigger Click Neural Pulses
        window.addEventListener('click', (e) => {
            // Project click to world coordinates
            const clickPos = screenToWorld(e.clientX, e.clientY);
            const rootNodeIdx = findClosestNodeIndex(clickPos);

            if (rootNodeIdx !== -1) {
                // Trigger neural ripple propagation
                clickRipples.push({
                    activeNodes: [rootNodeIdx],
                    visited: new Set([rootNodeIdx]),
                    intensity: 1.0,
                    generation: 0,
                    lastPropagationTime: Date.now()
                });
            }
            lastInteractionTime = Date.now();
            isIdle = false;
        });

        // Resize handler
        window.addEventListener('resize', () => {
            renderer.setSize(window.innerWidth, window.innerHeight);
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();

            const aspect = window.innerWidth / window.innerHeight;
            const heightLimit = 10 * Math.tan((camera.fov * Math.PI) / 360);
            const widthLimit = heightLimit * aspect;

            // Recenter/rescale nodes
            nodes.forEach(n => {
                n.position.x = (n.position.x / n.widthLimit) * widthLimit;
                n.position.y = (n.position.y / n.heightLimit) * heightLimit;
                n.widthLimit = widthLimit;
                n.heightLimit = heightLimit;
                n.basePosition.copy(n.position);
            });
        });

        // Exposed Global Keystroke Trigger for terminal console integrations
        window.triggerNeuralKeystrokePulse = function () {
            // Find terminal console element
            const consoleEl = document.getElementById('vibe-console');
            if (consoleEl) {
                const bounds = getElement3DBounds(consoleEl);
                const consoleCenter = bounds.center;
                const closestIdx = findClosestNodeIndex(consoleCenter);

                if (closestIdx !== -1) {
                    // Temporarily boost closest node and its neighbors
                    nodes[closestIdx].activation = 2.0;
                    nodes[closestIdx].neighbors.forEach(nIdx => {
                        nodes[nIdx].activation = 1.3;
                        const syn = findSynapse(closestIdx, nIdx);
                        if (syn) {
                            syn.pulseIntensity = 1.0;
                        }
                        spawnPacket(closestIdx, nIdx, 0x22d3ee, 0.08, PACKET_SPEED * 1.5);
                    });
                }
            }
            lastInteractionTime = Date.now();
            isIdle = false;
        };

        // DOM hover listeners binding
        function bindDOMHovers() {
            const cards = document.querySelectorAll('.case-study, .exploration-card');
            cards.forEach(card => {
                card.addEventListener('mouseenter', () => {
                    hoveredCard = card;
                    lastInteractionTime = Date.now();
                });
                card.addEventListener('mouseleave', () => {
                    hoveredCard = null;
                });
            });

            const navLinks = document.querySelectorAll('.nav-links a, #nav-logo');
            navLinks.forEach(link => {
                link.addEventListener('mouseenter', () => {
                    hoveredNavLink = link;
                    lastInteractionTime = Date.now();
                    triggerRouteToElement(link);
                });
                link.addEventListener('mouseleave', () => {
                    hoveredNavLink = null;
                });
            });

            const chatBtn = document.getElementById('chat-fab-trigger');
            if (chatBtn) {
                chatBtn.addEventListener('mouseenter', () => {
                    hoveredChatButton = true;
                    lastInteractionTime = Date.now();
                });
                chatBtn.addEventListener('mouseleave', () => {
                    hoveredChatButton = false;
                });
            }
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', bindDOMHovers);
        } else {
            bindDOMHovers();
        }
    }

    // WebGL Loop Update & Calculations
    let prevTime = 0;
    function animate(time) {
        requestAnimationFrame(animate);

        const delta = Math.min((time - prevTime) / 1000, 0.1);
        prevTime = time;

        // 1. Idle mode evaluation
        if (Date.now() - lastInteractionTime > 5000) {
            isIdle = true;
        }

        // Read scroll velocity from cursor.js
        const scrollVel = window._neuralScrollVelocity || 0;
        const absScrollVel = Math.abs(scrollVel);
        const isScrollSurge = absScrollVel > 12;

        // On fast scroll: fire an upward sweep ripple
        if (isScrollSurge && Math.random() < 0.25) {
            // Pick a random node and start a BFS ripple from it
            const randomIdx = Math.floor(Math.random() * nodes.length);
            clickRipples.push({
                activeNodes: [randomIdx],
                visited: new Set([randomIdx]),
                intensity: 0.6 + absScrollVel / 60,
                generation: 0,
                lastPropagationTime: Date.now()
            });
        }

        // Interpolate mouse coordinates gently
        mouse.x += (mouse.targetX - mouse.x) * 0.1;
        mouse.y += (mouse.targetY - mouse.y) * 0.1;
        mouse3D.copy(screenToWorld(mouse.clientX, mouse.clientY));

        // 2. Physics & Node Movement Updates
        const nodePositions = pointsGeometry.attributes.position.array;
        const nodeColors = pointsGeometry.attributes.color.array;
        const nodeSizes = pointsGeometry.attributes.size.array;

        // Card Hover Bounds evaluation
        let cardBounds = null;
        if (hoveredCard) {
            cardBounds = getElement3DBounds(hoveredCard);
        }

        // Chat Button Location evaluation
        let chatBounds = null;
        const chatBtn = document.getElementById('chat-fab-trigger');
        if (hoveredChatButton && chatBtn) {
            chatBounds = getElement3DBounds(chatBtn);
        }

        nodes.forEach((node, idx) => {
            // Section-specific drift multipliers
            let sectionDriftAmp = 0.08;
            let sectionDriftSpeed = 0.4;
            let baseActivationFloor = 0.15;

            if (activeSection === 'experiments') {
                sectionDriftAmp = 0.18;   // chaotic
                sectionDriftSpeed = 0.9;
                baseActivationFloor = 0.22;
            } else if (activeSection === 'about') {
                sectionDriftAmp = 0.04;   // calm
                sectionDriftSpeed = 0.2;
                baseActivationFloor = 0.08;
            } else if (activeSection === 'contact') {
                sectionDriftAmp = 0.06;
                sectionDriftSpeed = 0.3;
                baseActivationFloor = 0.12;
            } else if (activeSection === 'work') {
                sectionDriftAmp = 0.06;
                sectionDriftSpeed = 0.35;
                baseActivationFloor = 0.18;
            }

            // Scroll velocity modulates drift amplitude
            sectionDriftAmp += absScrollVel * 0.003;

            // Ambient wave organic drift — section + idle aware
            const driftAmp = isIdle ? 0.25 : sectionDriftAmp;
            const driftSpeed = isIdle ? 1.0 : sectionDriftSpeed;
            const driftX = Math.sin(time * 0.001 * driftSpeed + node.phaseX) * driftAmp;
            const driftY = Math.cos(time * 0.001 * driftSpeed + node.phaseY) * driftAmp;

            // Apply steering/hover forces
            let hoverForce = new THREE.Vector3(0, 0, 0);
            
            // card hover behavior: cluster nodes around card boundaries
            if (cardBounds) {
                const distToCard = node.basePosition.distanceTo(cardBounds.center);
                if (distToCard < cardBounds.width * 1.5) {
                    // Interpolate node target to card borders
                    const targetX = Math.max(cardBounds.xMin, Math.min(node.basePosition.x, cardBounds.xMax));
                    const targetY = Math.max(cardBounds.yMin, Math.min(node.basePosition.y, cardBounds.yMax));
                    const boundaryTarget = new THREE.Vector3(targetX, targetY, node.basePosition.z);
                    
                    hoverForce.copy(boundaryTarget).sub(node.position).multiplyScalar(0.08);
                    
                    // Boost activation
                    node.targetActivation = 1.0;
                    
                    // Occasionally spawn packet into card
                    if (Math.random() < 0.015) {
                        spawnPacket(idx, findClosestNodeIndex(cardBounds.center), 0x22d3ee, 0.05, PACKET_SPEED * 0.7);
                    }
                } else {
                    node.targetActivation = 0.15;
                }
            }
            // chat button hover: route traffic stream toward button
            else if (chatBounds) {
                const distToChat = node.basePosition.distanceTo(chatBounds.center);
                if (distToChat < 4.5) {
                    // Pull nodes into a stream flow targeting the chat button center
                    hoverForce.copy(chatBounds.center).sub(node.position).normalize().multiplyScalar(0.18);
                    node.targetActivation = 1.1;

                    // Stream packet towards chat button
                    if (Math.random() < 0.025) {
                        const targetNodeIdx = findClosestNodeIndex(chatBounds.center);
                        if (targetNodeIdx !== -1 && targetNodeIdx !== idx) {
                            spawnPacket(idx, targetNodeIdx, 0xc084fc, 0.07, PACKET_SPEED * 1.4);
                        }
                    }
                } else {
                    node.targetActivation = 0.15;
                }
            }
            // standard mouse stimulus
            else if (mouse.active) {
                const distToMouse = node.position.distanceTo(mouse3D);
                if (distToMouse < 2.0) {
                    const stimStrength = (1.0 - distToMouse / 2.0);
                    // Gentle attraction
                    hoverForce.copy(mouse3D).sub(node.position).multiplyScalar(stimStrength * ATTRACT_SPEED);
                    // Boost activation
                    node.targetActivation = 0.15 + stimStrength * 0.85;
                } else {
                    node.targetActivation = 0.15;
                }
            } else {
                node.targetActivation = 0.15;
            }

            // Idle mode ambient packets
            if (isIdle && Math.random() < 0.0006) {
                const randomNeighbor = node.neighbors[Math.floor(Math.random() * node.neighbors.length)];
                if (randomNeighbor !== undefined) {
                    spawnPacket(idx, randomNeighbor, 0xffffff, 0.05, PACKET_SPEED * 0.5);
                }
            }

            // Smooth activation decay/rise
            node.activation += (node.targetActivation - node.activation) * 0.05;

            // Combine forces
            node.velocity.add(hoverForce).multiplyScalar(0.9); // drag
            node.position.addScaledVector(node.velocity, delta);

            // Keep node anchored close to base positions (except when card bounds pull them)
            const driftForceFactor = cardBounds || chatBounds ? 0.01 : 0.05;
            node.position.x += (node.basePosition.x + driftX - node.position.x) * driftForceFactor;
            node.position.y += (node.basePosition.y + driftY - node.position.y) * driftForceFactor;
            node.position.z += (node.basePosition.z - node.position.z) * 0.03;

            // Update buffer arrays
            nodePositions[idx * 3] = node.position.x;
            nodePositions[idx * 3 + 1] = node.position.y;
            nodePositions[idx * 3 + 2] = node.position.z;

            // Nodes glow brighter with higher activation
            const act = node.activation;
            nodeColors[idx * 3] = node.color.r * act;
            nodeColors[idx * 3 + 1] = node.color.g * act;
            nodeColors[idx * 3 + 2] = node.color.b * act;

            nodeSizes[idx] = node.size * (0.85 + act * 0.8);
        });

        pointsGeometry.attributes.position.needsUpdate = true;
        pointsGeometry.attributes.color.needsUpdate = true;
        pointsGeometry.attributes.size.needsUpdate = true;

        // 3. Update Synapses (Lines segments)
        const linePos = lineGeometry.attributes.position.array;
        const lineCol = lineGeometry.attributes.color.array;

        synapses.forEach((syn, idx) => {
            const nodeA = nodes[syn.from];
            const nodeB = nodes[syn.to];

            linePos[idx * 6] = nodeA.position.x;
            linePos[idx * 6 + 1] = nodeA.position.y;
            linePos[idx * 6 + 2] = nodeA.position.z;

            linePos[idx * 6 + 3] = nodeB.position.x;
            linePos[idx * 6 + 4] = nodeB.position.y;
            linePos[idx * 6 + 5] = nodeB.position.z;

            // Decay line pulse intensity
            syn.pulseIntensity *= 0.93;

            // Compute connection strength based on nodes activation
            const avgActivation = (nodeA.activation + nodeB.activation) / 2;
            syn.weight = syn.baseWeight * (0.7 + avgActivation * 1.5) + syn.pulseIntensity * 0.6;

            const factor = syn.weight;
            lineCol[idx * 6] = syn.color.r * factor;
            lineCol[idx * 6 + 1] = syn.color.g * factor;
            lineCol[idx * 6 + 2] = syn.color.b * factor;

            lineCol[idx * 6 + 3] = syn.color.r * factor;
            lineCol[idx * 6 + 4] = syn.color.g * factor;
            lineCol[idx * 6 + 5] = syn.color.b * factor;
        });

        lineGeometry.attributes.position.needsUpdate = true;
        lineGeometry.attributes.color.needsUpdate = true;

        // 4. Update Click Wave Propagation (Ripples)
        const now = Date.now();
        for (let r = clickRipples.length - 1; r >= 0; r--) {
            const rip = clickRipples[r];

            // Propagate signals along graph paths every 70ms
            if (now - rip.lastPropagationTime > 70) {
                rip.lastPropagationTime = now;
                const nextNodes = [];

                rip.activeNodes.forEach(nodeIdx => {
                    const neighbors = nodes[nodeIdx].neighbors;
                    neighbors.forEach(nIdx => {
                        if (!rip.visited.has(nIdx)) {
                            rip.visited.add(nIdx);
                            nextNodes.push(nIdx);

                            // Ignite connections
                            const syn = findSynapse(nodeIdx, nIdx);
                            if (syn) {
                                syn.pulseIntensity = rip.intensity;
                            }

                            // Launch speed-boosted click packet
                            spawnPacket(nodeIdx, nIdx, 0x22d3ee, 0.09, PACKET_SPEED * 1.6);
                        }
                    });
                });

                rip.activeNodes = nextNodes;
                rip.intensity *= 0.75;
                rip.generation++;

                // Stop propagation after 4 hops or when all nodes visited
                if (rip.generation > 4 || rip.activeNodes.length === 0) {
                    clickRipples.splice(r, 1);
                }
            }
        }

        // 5. Update Packets (Progress and route traversal)
        const packPos = packetGeometry.attributes.position.array;
        const packCol = packetGeometry.attributes.color.array;
        const packSize = packetGeometry.attributes.size.array;

        packets.forEach((p, idx) => {
            if (p.free) {
                // Keep offscreen
                packPos[idx * 3] = 9999;
                packPos[idx * 3 + 1] = 9999;
                packPos[idx * 3 + 2] = 0;
                packCol[idx * 3] = 0;
                packCol[idx * 3 + 1] = 0;
                packCol[idx * 3 + 2] = 0;
                packSize[idx] = 0.0;
                return;
            }

            p.progress += p.speed * delta;

            const nodeA = nodes[p.fromNode];
            const nodeB = nodes[p.toNode];

            if (p.progress >= 1.0) {
                // Check if packet has a route to follow
                if (p.route && p.routeIndex < p.route.length - 2) {
                    p.routeIndex++;
                    p.fromNode = p.route[p.routeIndex];
                    p.toNode = p.route[p.routeIndex + 1];
                    p.progress = 0.0;
                } else {
                    // Reached end of line/route
                    p.free = true;
                    return;
                }
            }

            // Interpolate packet position
            const pos = new THREE.Vector3().copy(nodeA.position).lerp(nodeB.position, p.progress);
            packPos[idx * 3] = pos.x;
            packPos[idx * 3 + 1] = pos.y;
            packPos[idx * 3 + 2] = pos.z;

            // Vertex Colors glow
            packCol[idx * 3] = p.color.r;
            packCol[idx * 3 + 1] = p.color.g;
            packCol[idx * 3 + 2] = p.color.b;

            // Scale size based on progression (fade in/out slightly near endpoints)
            const scale = Math.sin(p.progress * Math.PI);
            packSize[idx] = p.size * (0.5 + scale * 0.5);
        });

        packetGeometry.attributes.position.needsUpdate = true;
        packetGeometry.attributes.color.needsUpdate = true;
        packetGeometry.attributes.size.needsUpdate = true;

        renderer.render(scene, camera);
    }

    /* =========================================================
       SECTION DETECTION via IntersectionObserver
    ========================================================= */
    function initSectionObserver() {
        const sections = [
            { id: 'work',        name: 'work' },
            { id: 'experiments', name: 'experiments' },
            { id: 'about',       name: 'about' },
            { id: 'contact',     name: 'contact' }
        ];

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const newSection = sections.find(s => s.id === entry.target.id);
                    if (newSection && newSection.name !== activeSection) {
                        activeSection = newSection.name;
                        sectionTransitionTimer = 120; // frames to run transition signal

                        // Fire transition sweep: send a wave of packets from top of viewport downward
                        const topAreaNodes = nodes
                            .filter(n => n.basePosition.y > 0) // upper half of 3D space
                            .slice(0, 6);

                        topAreaNodes.forEach((n, i) => {
                            const destIdx = Math.floor(Math.random() * nodes.length);
                            setTimeout(() => {
                                if (n && nodes[destIdx]) {
                                    spawnPacket(nodes.indexOf(n), destIdx, 0xffffff, 0.07, PACKET_SPEED * 1.5);
                                }
                            }, i * 80);
                        });

                        // Experiments mode: create temp synapses
                        if (activeSection === 'experiments') {
                            for (let i = 0; i < 12; i++) {
                                const a = Math.floor(Math.random() * nodes.length);
                                const b = Math.floor(Math.random() * nodes.length);
                                if (a !== b) {
                                    tempSynapses.push({ from: a, to: b, life: 60 + Math.random() * 90 });
                                }
                            }
                        }
                    }
                }
            });
        }, { threshold: 0.3 });

        sections.forEach(s => {
            const el = document.getElementById(s.id);
            if (el) observer.observe(el);
        });
    }

    // Self-initialize once loaded
    init();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSectionObserver);
    } else {
        initSectionObserver();
    }
})();
