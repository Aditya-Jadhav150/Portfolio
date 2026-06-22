/**
 * Neural Cursor Engine — cursor.js
 * A living miniature AI brain that replaces the default cursor.
 * Deep integration with scroll, hover states, and click pulses.
 */
(function () {
    'use strict';

    /* =========================================================
       CANVAS SETUP
    ========================================================= */
    const canvas = document.getElementById('neural-cursor-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    /* =========================================================
       GLOBAL STATE
    ========================================================= */
    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const cursor = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let mouseVx = 0, mouseVy = 0;
    let prevMouseX = mouse.x, prevMouseY = mouse.y;
    let speed = 0;
    let isVisible = false;

    // Cursor State Machine
    // 'default' | 'button-chat' | 'button-view' | 'card' | 'terminal'
    let cursorState = 'default';
    let stateLabel = '';
    let stateLerp = 0; // 0 = fully default, 1 = fully morphed

    // Click pulses
    const clickPulses = [];

    // Trail system
    const trails = [];
    const MAX_TRAILS = 22;

    /* =========================================================
       SATELLITE NODES (orbital mini-nodes)
    ========================================================= */
    const NUM_SATELLITES = 6;
    const satellites = [];

    for (let i = 0; i < NUM_SATELLITES; i++) {
        const angle = (i / NUM_SATELLITES) * Math.PI * 2;
        const baseRadius = 28;
        satellites.push({
            angle,
            baseRadius,
            radius: baseRadius,
            // Spring-physics position
            x: cursor.x + Math.cos(angle) * baseRadius,
            y: cursor.y + Math.sin(angle) * baseRadius,
            vx: 0,
            vy: 0,
            orbitSpeed: 0.008 + (i % 2 === 0 ? 0.004 : -0.002), // slight variation
            phaseOffset: (i / NUM_SATELLITES) * Math.PI * 2,
            size: 2.5 + Math.random() * 1.5,
            alpha: 0.7 + Math.random() * 0.3,
            // Packet data
            packetProgress: Math.random(),
            packetDirection: i % 2 === 0 ? 1 : -1
        });
    }

    // Extra nodes that appear in card mode
    const extraNodes = [];
    const NUM_EXTRA = 4;
    for (let i = 0; i < NUM_EXTRA; i++) {
        extraNodes.push({
            x: cursor.x,
            y: cursor.y,
            vx: 0, vy: 0,
            targetAngle: (i / NUM_EXTRA) * Math.PI * 2 + Math.PI / NUM_EXTRA,
            targetRadius: 52,
            alpha: 0,
            size: 2.0
        });
    }

    /* =========================================================
       TIME
    ========================================================= */
    let frameTime = 0;
    let lastFrame = 0;

    /* =========================================================
       MOUSE EVENTS
    ========================================================= */
    window.addEventListener('mousemove', (e) => {
        mouseVx = e.clientX - prevMouseX;
        mouseVy = e.clientY - prevMouseY;
        speed = Math.sqrt(mouseVx * mouseVx + mouseVy * mouseVy);
        prevMouseX = e.clientX;
        prevMouseY = e.clientY;
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        if (!isVisible) isVisible = true;
    });

    window.addEventListener('mouseleave', () => { isVisible = false; });
    window.addEventListener('mouseenter', () => { isVisible = true; });

    /* =========================================================
       CLICK PULSE
    ========================================================= */
    window.addEventListener('click', (e) => {
        clickPulses.push({
            x: e.clientX,
            y: e.clientY,
            radius: 0,
            maxRadius: 120,
            alpha: 1.0,
            ringCount: 3,
            // Staggered rings
            rings: [
                { r: 0, speed: 2.8, alpha: 1.0 },
                { r: 0, speed: 2.0, alpha: 0.7 },
                { r: 0, speed: 1.4, alpha: 0.5 }
            ],
            // Burst micro-nodes
            burstNodes: Array.from({ length: 8 }, (_, i) => ({
                angle: (i / 8) * Math.PI * 2,
                r: 0,
                speed: 2.5 + Math.random() * 1.5,
                alpha: 1.0,
                size: 3
            }))
        });
    });

    /* =========================================================
       HOVER STATE DETECTION
    ========================================================= */
    function detectHoverState(e) {
        const el = e.target;

        if (el.matches('#vibe-console, #vibe-console *')) {
            cursorState = 'terminal';
            stateLabel = 'AI>';
            return;
        }

        if (el.matches('.case-study, .case-study *, .exploration-card, .exploration-card *')) {
            cursorState = 'card';
            stateLabel = '';
            return;
        }

        if (el.matches('#chat-fab-trigger, #chat-fab-trigger *')) {
            cursorState = 'button-chat';
            stateLabel = '[ CHAT ]';
            return;
        }

        if (el.matches('.btn, .btn *, .explore-project-btn, .explore-project-btn *, .terminal-chip, .terminal-chip *, .chip-btn, .chip-btn *')) {
            cursorState = 'button-view';
            stateLabel = '[ VIEW ]';
            return;
        }

        if (el.matches('a, a *, button, button *')) {
            cursorState = 'button-view';
            stateLabel = '[ VIEW ]';
            return;
        }

        cursorState = 'default';
        stateLabel = '';
    }

    document.addEventListener('mousemove', detectHoverState);

    /* =========================================================
       TRAIL SYSTEM
    ========================================================= */
    function addTrail() {
        if (speed > 4) {
            trails.push({
                x: cursor.x,
                y: cursor.y,
                alpha: Math.min(speed / 30, 0.6),
                radius: 3 + speed * 0.15,
                decay: 0.04 + speed * 0.002
            });
            if (trails.length > MAX_TRAILS) trails.shift();
        }
    }

    /* =========================================================
       DRAW HELPERS
    ========================================================= */
    function drawConnection(x1, y1, x2, y2, alpha, color = '34, 211, 238') {
        ctx.save();
        ctx.strokeStyle = `rgba(${color}, ${alpha})`;
        ctx.lineWidth = 0.8;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();
    }

    function drawGlowNode(x, y, radius, alpha, color = '34, 211, 238', glowRadius = null) {
        ctx.save();
        const gr = glowRadius || radius * 3;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, gr);
        grad.addColorStop(0, `rgba(${color}, ${Math.min(alpha, 1)})`);
        grad.addColorStop(0.4, `rgba(${color}, ${alpha * 0.4})`);
        grad.addColorStop(1, `rgba(${color}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, gr, 0, Math.PI * 2);
        ctx.fill();

        // Solid core
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    /* =========================================================
       MAIN ANIMATION LOOP
    ========================================================= */
    let time = 0;

    function animate(ts) {
        requestAnimationFrame(animate);

        const dt = Math.min((ts - lastFrame) / 1000, 0.05);
        lastFrame = ts;
        time += dt;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!isVisible) return;

        // ---- Cursor spring follow ----
        const SPRING_STIFFNESS = 0.22;
        const SPRING_DAMPING = 0.72;
        cursor.x += (mouse.x - cursor.x) * SPRING_STIFFNESS;
        cursor.y += (mouse.y - cursor.y) * SPRING_STIFFNESS;

        // ---- Speed & expansion factor ----
        const speedFactor = Math.min(speed / 20, 1.0);
        const expansionScale = 1.0 + speedFactor * 0.45;
        speed *= SPRING_DAMPING; // decay speed smoothly

        // ---- Add trail at current cursor position ----
        addTrail();

        // ---- Lerp stateLerp ----
        const targetLerp = cursorState !== 'default' ? 1 : 0;
        stateLerp += (targetLerp - stateLerp) * 0.12;

        /* ==================================================
           DRAW TRAILS
        ================================================== */
        trails.forEach((t, i) => {
            t.alpha -= t.decay;
            if (t.alpha <= 0) {
                trails.splice(i, 1);
                return;
            }
            const grad = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, t.radius * 2);
            grad.addColorStop(0, `rgba(34, 211, 238, ${t.alpha * 0.5})`);
            grad.addColorStop(1, `rgba(34, 211, 238, 0)`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(t.x, t.y, t.radius * 2, 0, Math.PI * 2);
            ctx.fill();
        });

        /* ==================================================
           DRAW CLICK PULSES
        ================================================== */
        for (let i = clickPulses.length - 1; i >= 0; i--) {
            const pulse = clickPulses[i];
            let allDone = true;

            // Draw expanding rings
            pulse.rings.forEach(ring => {
                ring.r += ring.speed;
                ring.alpha -= 0.022;
                if (ring.alpha > 0) {
                    allDone = false;
                    ctx.save();
                    ctx.strokeStyle = `rgba(34, 211, 238, ${ring.alpha})`;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(pulse.x, pulse.y, ring.r, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.restore();
                }
            });

            // Draw burst micro-nodes
            pulse.burstNodes.forEach(bn => {
                bn.r += bn.speed;
                bn.alpha -= 0.035;
                if (bn.alpha > 0) {
                    allDone = false;
                    const bx = pulse.x + Math.cos(bn.angle) * bn.r;
                    const by = pulse.y + Math.sin(bn.angle) * bn.r;
                    // Draw line from center to node
                    ctx.save();
                    ctx.strokeStyle = `rgba(34, 211, 238, ${bn.alpha * 0.5})`;
                    ctx.lineWidth = 0.7;
                    ctx.beginPath();
                    ctx.moveTo(pulse.x, pulse.y);
                    ctx.lineTo(bx, by);
                    ctx.stroke();
                    ctx.restore();
                    drawGlowNode(bx, by, bn.size * 0.5, bn.alpha, '34, 211, 238', bn.size * 2);
                }
            });

            if (allDone) clickPulses.splice(i, 1);
        }

        /* ==================================================
           SATELLITE PHYSICS & DRAW
        ================================================== */
        const isCardState = cursorState === 'card';
        const isTerminalState = cursorState === 'terminal';
        const isButtonState = cursorState === 'button-chat' || cursorState === 'button-view';

        // Orbit radius scales with state and speed
        const baseOrbitRadius = 28 * expansionScale;
        const orbitRadius = isCardState
            ? baseOrbitRadius * 1.5
            : isTerminalState
                ? baseOrbitRadius * 0.85
                : baseOrbitRadius;

        // Orbit speed scales with mouse speed
        const orbitSpeedBoost = 1.0 + speedFactor * 1.8;

        satellites.forEach((sat, i) => {
            // Update orbital angle
            sat.angle += sat.orbitSpeed * orbitSpeedBoost;

            // Elliptical deformation based on velocity direction
            const velAngle = Math.atan2(mouseVy, mouseVx);
            const dotProd = Math.cos(sat.angle - velAngle);
            const deformScale = 1.0 + speedFactor * 0.3 * dotProd;

            // Target position in orbit
            const targetX = cursor.x + Math.cos(sat.angle) * orbitRadius * deformScale;
            const targetY = cursor.y + Math.sin(sat.angle) * orbitRadius;

            // Spring physics
            const SAT_STIFFNESS = 0.18;
            const SAT_DAMPING = 0.72;
            sat.vx += (targetX - sat.x) * SAT_STIFFNESS;
            sat.vy += (targetY - sat.y) * SAT_STIFFNESS;
            sat.vx *= SAT_DAMPING;
            sat.vy *= SAT_DAMPING;
            sat.x += sat.vx;
            sat.y += sat.vy;

            // Draw connection from cursor core to satellite
            const connAlpha = isButtonState ? 0 : 0.25 * (1 - stateLerp * 0.4);
            if (!isButtonState) {
                drawConnection(cursor.x, cursor.y, sat.x, sat.y, connAlpha);
            }

            // Draw connection to adjacent satellite (ring)
            const nextSat = satellites[(i + 1) % NUM_SATELLITES];
            drawConnection(sat.x, sat.y, nextSat.x, nextSat.y, connAlpha * 0.6);

            // Draw satellite node
            const satAlpha = sat.alpha * (isButtonState ? 0 : 1.0);
            if (satAlpha > 0.02) {
                drawGlowNode(sat.x, sat.y, sat.size, satAlpha, '34, 211, 238', sat.size * 3.5);
            }

            // Data packet on connection: cursor → satellite
            sat.packetProgress += 0.025 * orbitSpeedBoost * sat.packetDirection;
            if (sat.packetProgress > 1) sat.packetProgress = 0;
            if (sat.packetProgress < 0) sat.packetProgress = 1;

            const px = cursor.x + (sat.x - cursor.x) * sat.packetProgress;
            const py = cursor.y + (sat.y - cursor.y) * sat.packetProgress;
            const packetAlpha = (0.5 + Math.sin(sat.packetProgress * Math.PI) * 0.5) * (isButtonState ? 0 : 0.9);
            if (packetAlpha > 0.05) {
                drawGlowNode(px, py, 1.5, packetAlpha, '255, 255, 255', 4);
            }
        });

        /* ==================================================
           EXTRA CARD-MODE NODES
        ================================================== */
        extraNodes.forEach((en, i) => {
            const targetAlpha = isCardState ? 1.0 : 0;
            en.alpha += (targetAlpha - en.alpha) * 0.1;

            const targetR = isCardState ? 52 + speedFactor * 10 : 28;
            const tx = cursor.x + Math.cos(en.targetAngle + time * 0.6) * targetR;
            const ty = cursor.y + Math.sin(en.targetAngle + time * 0.6) * targetR;

            en.vx += (tx - en.x) * 0.14;
            en.vy += (ty - en.y) * 0.14;
            en.vx *= 0.72;
            en.vy *= 0.72;
            en.x += en.vx;
            en.y += en.vy;

            if (en.alpha > 0.05) {
                drawConnection(cursor.x, cursor.y, en.x, en.y, en.alpha * 0.35, '192, 132, 252');
                drawGlowNode(en.x, en.y, en.size, en.alpha, '192, 132, 252', en.size * 4);

                // Packet flowing outward toward card direction
                const pFrac = ((time * 0.8 + i * 0.25) % 1.0);
                const epx = cursor.x + (en.x - cursor.x) * pFrac;
                const epy = cursor.y + (en.y - cursor.y) * pFrac;
                const epa = Math.sin(pFrac * Math.PI) * en.alpha * 0.9;
                if (epa > 0.05) drawGlowNode(epx, epy, 1.4, epa, '255, 255, 255', 4);
            }
        });

        /* ==================================================
           CORE NODE DRAW
        ================================================== */
        // Fade out core completely on buttons so native pointer is clear
        const coreAlpha = isButtonState ? 0 : 1.0;
        const corePulse = 1.0 + Math.sin(time * 5.5) * 0.15;
        const coreSize = (isCardState ? 6 : isTerminalState ? 5 : 5) * corePulse * expansionScale;

        if (!isButtonState && coreAlpha > 0) {
            drawGlowNode(cursor.x, cursor.y, coreSize, coreAlpha, '34, 211, 238', coreSize * 4);
        }

        /* ==================================================
           BUTTON MORPH LABEL (REMOVED FOR CLEAN POINTER)
        ================================================== */
        // We no longer draw the [ VIEW ] or [ CHAT ] pill labels because
        // we are yielding to the clean, native system pointer on hover.

        /* ==================================================
           TERMINAL MORPH LABEL
        ================================================== */
        if (isTerminalState && stateLerp > 0.1) {
            const labelAlpha = stateLerp;
            ctx.save();
            ctx.font = `bold 13px 'Fira Code', monospace`;
            ctx.fillStyle = `rgba(0, 255, 180, ${labelAlpha})`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';

            // Animated blinking cursor
            const showBlink = Math.floor(time * 2) % 2 === 0;
            const label = 'AI>' + (showBlink ? '█' : ' ');
            ctx.fillText(label, cursor.x + 12, cursor.y - 2);

            // Bracket underline
            ctx.strokeStyle = `rgba(0, 255, 180, ${labelAlpha * 0.4})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(cursor.x + 10, cursor.y + 10);
            ctx.lineTo(cursor.x + 10 + ctx.measureText(label).width, cursor.y + 10);
            ctx.stroke();

            ctx.restore();
        }
    }

    requestAnimationFrame(animate);

    /* =========================================================
       SCROLL REACTIONS — expose to neural_network_cursor.js
    ========================================================= */
    let lastScrollY = window.scrollY;
    let scrollVelocity = 0;

    window.addEventListener('scroll', () => {
        const dy = window.scrollY - lastScrollY;
        scrollVelocity = dy;
        lastScrollY = window.scrollY;

        // Expose scroll velocity for background network
        window._neuralScrollVelocity = scrollVelocity;
    });

    // Smooth scroll velocity decay
    setInterval(() => {
        scrollVelocity *= 0.88;
        window._neuralScrollVelocity = scrollVelocity;
    }, 16);

})();
