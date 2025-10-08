"use strict";
let canvas, gl, program;
let modelViewMatrix, projectionMatrix, modelViewMatrixLoc, projectionMatrixLoc;
let vertices = [], vertexColors = [], indices = [];
let isAnimating = false, animationPreset = 'spin', animationTime = 0;

// Projection control variables
let projectionMode = 'perspective';
let fov = 50, nearPlane = 0.1, farPlane = 100;
let orthoLeft = -2, orthoRight = 2, orthoBottom = -2, orthoTop = 2;

// Camera control variables
let eyeX = 0, eyeY = 0, eyeZ = 3;
let atX = 0, atY = 0, atZ = 0;
let upX = 0, upY = 1, upZ = 0;

init();

function init() {
    canvas = document.getElementById("gl-canvas");
    gl = canvas.getContext('webgl2');
    if (!gl) alert("WebGL 2.0 isn't available");

    gl.clearColor(1, 1, 1, 1);
    gl.enable(gl.DEPTH_TEST);

    program = initShaders(gl, "vertex-shader", "fragment-shader");
    gl.useProgram(program);

    createMonitor();
    setupBuffers();

    modelViewMatrixLoc = gl.getUniformLocation(program, "modelViewMatrix");
    projectionMatrixLoc = gl.getUniformLocation(program, "projectionMatrix");
    
    setupEventListeners();
    
    // Initialize projection matrix and UI
    updateProjectionMatrix();
    updateProjectionUI();
    
    render();
}

function createMonitor() {
    const bezelColor = vec4(0.2, 0.2, 0.2, 1.0);
    const panelColor = vec4(0.05, 0.05, 0.05, 1.0);
    const standColor = vec4(0.15, 0.15, 0.15, 1.0);
    const baseColor = vec4(0.2, 0.2, 0.2, 1.0);

    const screenWidth = 0.7
    const screenHeight = 0.42
    const screenDepthFront = 0.02
    const screenDepthBack = 0.05
    const yOffset = 0.15

    const sideThickness = 0.002
    const frameDepth = screenDepthFront - 0.005
    const frameCenterZ = (screenDepthFront - screenDepthBack) / 2 + 0.02;

    // Buat frame & panel layar
    createCube(
        sideThickness, screenHeight - 0.005, 
        frameDepth, 
        bezelColor, 
        -screenWidth / 2 - sideThickness / 2, 
        yOffset, 
        frameCenterZ);
    createCube(
        sideThickness, 
        screenHeight - 0.005, 
        frameDepth, 
        bezelColor, 
        screenWidth / 2 + sideThickness / 2, 
        yOffset, 
        frameCenterZ);
    createCubeFace(
        screenWidth, 
        screenHeight, 
        screenDepthFront, 
        bezelColor, 
        0, 
        yOffset, 
        0);
    createCubeFace(
        screenWidth * 0.92, 
        screenHeight * 0.88, 
        screenDepthFront + 0.001, 
        panelColor, 
        0, 
        yOffset, 
        0);

    createCurvedBackPanel(
        screenWidth, 
        screenHeight, 
        screenDepthBack, 
        bezelColor, 
        0, 
        yOffset, 
        0);
    createCube(
        screenWidth,
        0.01,
        0.01,
        bezelColor,
        0,
        yOffset + (screenHeight / 2) - 0.005,
        0.005
    );
    createCube(
        screenWidth,
        0.01,
        0.01,
        bezelColor,
        0,
        yOffset - (screenHeight / 2) + 0.005,
        0.005
    );

    // Buat stand & base
    const standHeight = 0.2
    const standYPos = yOffset - (screenHeight / 2) - (standHeight / 2);

    createBoxWithHole(
        0.2, 
        0.35, 
        0.03, 
        0.05, 
        standColor, 
        standColor, 
        0, 
        standYPos + (standHeight / 2) - 0.05, 
        -screenDepthBack * 1.7, 
        -20, 
        0, 
        0, 
        50
    );

    const baseYPos = standYPos - (standHeight / 2) - 0.015;
    createCube(
        0.4, 
        0.03, 
        0.3, 
        baseColor, 
        0, 
        baseYPos, 
        -screenDepthBack * 0.5
    );
}

// Membuat kubus 
function createCube(width, height, depth, color, cx, cy, cz) {
    const w = width / 2, h = height / 2, d = depth / 2;
    const v = [
        vec3(-w + cx, -h + cy, d + cz), // 0
        vec3( w + cx, -h + cy, d + cz), // 1
        vec3( w + cx,  h + cy, d + cz), // 2
        vec3(-w + cx,  h + cy, d + cz), // 3
        vec3(-w + cx, -h + cy, -d + cz), // 4
        vec3( w + cx, -h + cy, -d + cz), // 5
        vec3( w + cx,  h + cy, -d + cz), // 6
        vec3(-w + cx,  h + cy, -d + cz)  // 7
    ];
    const startIndex = vertices.length;
    vertices.push(...v);
    for (let i = 0; i < 8; i++) vertexColors.push(color);
    const cubeIndices = [
        0,1,2,0,2,3, // depan
        4,5,6,4,6,7, // belakang
        3,2,6,3,6,7, // kanan
        0,1,5,0,5,4, // kiri
        4,0,3,4,3,7, // atas
        1,5,6,1,6,2 // bawah
    ];
    cubeIndices.forEach(index => indices.push(startIndex + index));
}

// Membuat balok dengan lubang lingkaran
function createBoxWithHole(width, height, depth, holeRadius, colorOuter, colorInner, cx, cy, cz, rotX, rotY, rotZ, segments) {
    segments = segments || 32;
    const w = width / 2;
    const h = height / 2;
    const d = depth / 2;
    const r = Math.min(holeRadius, 0.49 * Math.min(width, height));

    // Matriks rotasi lokal
    let R = mat4();
    R = mult(R, rotate(rotX, vec3(1, 0, 0)));
    R = mult(R, rotate(rotY, vec3(0, 1, 0)));
    R = mult(R, rotate(rotZ, vec3(0, 0, 1)));

    const frontCircle = []; // z = +d
    const backCircle = [];  // z = -d
    const frontRays = [];   // titik perpotongan dengan persegi panjang depan
    const backRays = [];    // titik perpotongan dengan persegi panjang belakang

    for (let i = 0; i < segments; i++) {
        const t = (i / segments) * 2 * Math.PI;
        const dx = Math.cos(t);
        const dy = Math.sin(t);

        // Titik lingkaran (depan & belakang)
        frontCircle.push(vec3(r * dx, r * dy, d));
        backCircle.push(vec3(r * dx, r * dy, -d));

        // Ray dari pusat menuju boundary persegi panjang (x in [-w,w], y in [-h,h])
        const sx = dx === 0 ? Infinity : w / Math.abs(dx);
        const sy = dy === 0 ? Infinity : h / Math.abs(dy);
        const s = Math.min(sx, sy); // skala minimum agar menyentuh sisi terdekat
        const rx = dx * s;
        const ry = dy * s;
        frontRays.push(vec3(rx, ry, d));
        backRays.push(vec3(rx, ry, -d));
    }

    // Helper: push vertex with rotation+translation and color
    function pushV(v3, color) {
        const v4 = vec4(v3[0], v3[1], v3[2], 1.0);
        const r4 = mult(R, v4);
        vertices.push(vec3(r4[0] + cx, r4[1] + cy, r4[2] + cz));
        vertexColors.push(color);
    }

    // Simpan offset untuk referensi indeks
    const baseFrontCircle = vertices.length;
    for (let i = 0; i < segments; i++) pushV(frontCircle[i], colorOuter);
    const baseBackCircle = vertices.length;
    for (let i = 0; i < segments; i++) pushV(backCircle[i], colorOuter);
    const baseFrontRays = vertices.length;
    for (let i = 0; i < segments; i++) pushV(frontRays[i], colorOuter);
    const baseBackRays = vertices.length;
    for (let i = 0; i < segments; i++) pushV(backRays[i], colorOuter);

    // 1) Front face: ring antara lingkaran dan persegi panjang (dua segitiga per segmen)
    for (let i = 0; i < segments; i++) {
        const i1 = (i + 1) % segments;
        const c0 = baseFrontCircle + i;
        const c1 = baseFrontCircle + i1;
        const r0 = baseFrontRays + i;
        const r1 = baseFrontRays + i1;
        // Triangles: c0, c1, r1  and  c0, r1, r0
        indices.push(c0, c1, r1);
        indices.push(c0, r1, r0);
    }

    // 2) Back face: ring (hati-hati orientasi, tapi culling tidak diaktifkan)
    for (let i = 0; i < segments; i++) {
        const i1 = (i + 1) % segments;
        const c0 = baseBackCircle + i;
        const c1 = baseBackCircle + i1;
        const r0 = baseBackRays + i;
        const r1 = baseBackRays + i1;
        indices.push(c0, r1, c1);
        indices.push(c0, r0, r1);
    }

    // 3) Dinding dalam (silinder) yang menghubungkan frontCircle ke backCircle
    // Gunakan warna dalam
    const baseInnerFront = vertices.length;
    for (let i = 0; i < segments; i++) pushV(frontCircle[i], colorInner);
    const baseInnerBack = vertices.length;
    for (let i = 0; i < segments; i++) pushV(backCircle[i], colorInner);
    for (let i = 0; i < segments; i++) {
        const i1 = (i + 1) % segments;
        const f0 = baseInnerFront + i;
        const f1 = baseInnerFront + i1;
        const b0 = baseInnerBack + i;
        const b1 = baseInnerBack + i1;
        // Quad: f0-b0-b1-f1
        indices.push(f0, b0, b1);
        indices.push(f0, b1, f1);
    }

    // 4) Empat sisi luar box (kiri, kanan, atas, bawah)
    function addQuad(v0, v1, v2, v3, color) {
        const s = vertices.length;
        pushV(v0, color); pushV(v1, color); pushV(v2, color); pushV(v3, color);
        indices.push(s + 0, s + 1, s + 2);
        indices.push(s + 0, s + 2, s + 3);
    }
    // Kiri (x = -w)
    addQuad(
        vec3(-w, -h,  d),
        vec3(-w, -h, -d),
        vec3(-w,  h, -d),
        vec3(-w,  h,  d),
        colorOuter
    );
    // Kanan (x = +w)
    addQuad(
        vec3( w, -h,  d),
        vec3( w,  h,  d),
        vec3( w,  h, -d),
        vec3( w, -h, -d),
        colorOuter
    );
    // Atas (y = +h)
    addQuad(
        vec3(-w,  h,  d),
        vec3(-w,  h, -d),
        vec3( w,  h, -d),
        vec3( w,  h,  d),
        colorOuter
    );
    // Bawah (y = -h)
    addQuad(
        vec3(-w, -h,  d),
        vec3( w, -h,  d),
        vec3( w, -h, -d),
        vec3(-w, -h, -d),
        colorOuter
    );
}

// Membuat satu sisi kubus (persegi panjang) untuk layar depan
function createCubeFace(width, height, depth, color, cx, cy, cz) {
    const w = width / 2;
    const h = height / 2;
    const d = depth / 2;

    const v = [
        vec3(-w + cx, -h + cy, d + cz),
        vec3( w + cx, -h + cy, d + cz),
        vec3( w + cx,  h + cy, d + cz),
        vec3(-w + cx,  h + cy, d + cz),
    ];
    
    const startIndex = vertices.length;
    vertices.push(...v);
    for (let i = 0; i < 4; i++) vertexColors.push(color);

    const faceIndices = [0, 1, 2, 0, 2, 3];
    for (const index of faceIndices) {
        indices.push(startIndex + index);
    }
}

// Membuat panel belakang yang melengkung
function createCurvedBackPanel(width, height, maxDepth, color, cx, cy, cz) {
    const w = width / 2;
    const h = height / 2;
    const segments = 20; // Jumlah pembagian untuk membuat kurva

    const startIndex = vertices.length;
    const backVertices = [];
    
    // Generate grid vertices untuk permukaan melengkung
    for (let j = 0; j <= segments; j++) {
        for (let i = 0; i <= segments; i++) {
            const u = i / segments; // 0 to 1
            const v = j / segments; // 0 to 1

            const x = cx + (u * width) - w;
            const y = cy + (v * height) - h;
            // Gunakan cosinus untuk membuat lekukan di sumbu Z
            const z = cz - (maxDepth * Math.cos((u - 0.5) * Math.PI));
            
            backVertices.push(vec3(x, y, z));
        }
    }
    
    vertices.push(...backVertices);
    for (let i = 0; i < backVertices.length; i++) vertexColors.push(color);

    // Buat indices untuk permukaan melengkung
    for (let j = 0; j < segments; j++) {
        for (let i = 0; i < segments; i++) {
            const row1 = j * (segments + 1);
            const row2 = (j + 1) * (segments + 1);
            indices.push(startIndex + row1 + i, startIndex + row1 + i + 1, startIndex + row2 + i + 1);
            indices.push(startIndex + row1 + i, startIndex + row2 + i + 1, startIndex + row2 + i);
        }
    }

    // Sambungkan sisi-sisi (dinding) antara depan dan belakang
    const frontBezel = [
        vec3(cx-w, cy-h, cz), vec3(cx+w, cy-h, cz),
        vec3(cx+w, cy+h, cz), vec3(cx-w, cy+h, cz)
    ];
    const frontStartIndex = vertices.length;
    vertices.push(...frontBezel);
    for(let i=0; i<4; i++) vertexColors.push(color);

    // Dinding Atas: buat strip penuh sepanjang lebar, menghubungkan tepi depan (z=cz) ke baris atas panel belakang (j=segments)
    const topFrontStart = vertices.length;
    for (let i = 0; i <= segments; i++) {
        const u = i / segments;
        const x = cx + (u * width) - w;
        const y = cy + h;
        const z = cz; // bidang depan
        vertices.push(vec3(x, y, z));
        vertexColors.push(color);
    }
    const topBackRowStart = startIndex + segments * (segments + 1);
    for (let i = 0; i < segments; i++) {
        const f0 = topFrontStart + i;
        const f1 = topFrontStart + i + 1;
        const b0 = topBackRowStart + i;
        const b1 = topBackRowStart + i + 1;
        indices.push(f0, f1, b1);
        indices.push(f0, b1, b0);
    }

    // Dinding Bawah: strip penuh sepanjang lebar, menghubungkan tepi depan (z=cz) ke baris bawah panel belakang (j=0)
    const bottomFrontStart = vertices.length;
    for (let i = 0; i <= segments; i++) {
        const u = i / segments;
        const x = cx + (u * width) - w;
        const y = cy - h;
        const z = cz; // bidang depan
        vertices.push(vec3(x, y, z));
        vertexColors.push(color);
    }
    const bottomBackRowStart = startIndex + 0; // j=0
    for (let i = 0; i < segments; i++) {
        const f0 = bottomFrontStart + i;
        const f1 = bottomFrontStart + i + 1;
        const b0 = bottomBackRowStart + i;
        const b1 = bottomBackRowStart + i + 1;
        indices.push(f0, b1, f1);
        indices.push(f0, b0, b1);
    }
}

// Upload geometry to GPU
function setupBuffers() {
    const iBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    const cBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(vertexColors), gl.STATIC_DRAW);
    const colorLoc = gl.getAttribLocation(program, "aColor");
    gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(colorLoc);
    const vBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(vertices), gl.STATIC_DRAW);
    const positionLoc = gl.getAttribLocation(program, "aPosition");
    gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(positionLoc);
}

// Main render loop
function render() {
    const get = id => document.getElementById(id);
    const bgColor = get('bg-color').value;
    let posX = +get('position-x').value, posY = +get('position-y').value, posZ = +get('position-z').value;
    let rotX = +get('rotation-x').value, rotY = +get('rotation-y').value, rotZ = +get('rotation-z').value;
    let scaleValue = +get('scale').value;
    
    if (isAnimating) {
        animationTime += 0.016;
        if (animationPreset === 'spin') {
            rotY = (animationTime * 50) % 360;
            get('rotation-y').value = rotY.toFixed(0);
            get('rotation-y-value').textContent = rotY.toFixed(0);
        } else if (animationPreset === 'bounce') {
            posY = 0.3 * Math.sin(animationTime * 4);
            get('position-y').value = posY.toFixed(2);
            get('position-y-value').textContent = posY.toFixed(2);
        } else if (animationPreset === 'pulse') {
            scaleValue = 1.0 + 0.2 * Math.sin(animationTime * 5);
            get('scale').value = scaleValue.toFixed(2);
            get('scale-value').textContent = scaleValue.toFixed(2);
        }
    }
    
    const [r, g, b] = hexToRgb(bgColor);
    gl.clearColor(r, g, b, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    // Update projection matrix
    updateProjectionMatrix();
    
    // Model-view matrix transformations
    let eye = vec3(eyeX, eyeY, eyeZ);
    let at = vec3(atX, atY, atZ);
    let up = vec3(upX, upY, upZ);
    let mvm = lookAt(eye, at, up);
    
    mvm = mult(mvm, translate(posX, posY, posZ));
    mvm = mult(mvm, rotate(rotZ, vec3(0, 0, 1)));
    mvm = mult(mvm, rotate(rotY, vec3(0, 1, 0)));
    mvm = mult(mvm, rotate(rotX, vec3(1, 0, 0)));
    mvm = mult(mvm, scale(scaleValue, scaleValue, scaleValue));
    
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(mvm));
    
    if (get('wireframe-mode').checked) {
        for (let i = 0; i < indices.length; i += 3) 
            gl.drawElements(gl.LINE_LOOP, 3, gl.UNSIGNED_SHORT, i * 2);
    } else {
        gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    }
    
    requestAnimationFrame(render);
}

// Function to update UI based on projection mode
function updateProjectionUI() {
    const perspectiveSettings = document.querySelectorAll('#fov, #near-plane, #far-plane').forEach(el => {
        if (el && el.closest('.control-row')) {
            el.closest('.control-row').style.display = projectionMode === 'perspective' ? 'flex' : 'none';
        }
    });
    
    const orthoSettings = document.querySelectorAll('#ortho-left, #ortho-right, #ortho-bottom, #ortho-top').forEach(el => {
        if (el && el.closest('.control-row')) {
            el.closest('.control-row').style.display = projectionMode === 'orthogonal' ? 'flex' : 'none';
        }
    });
    
    // Update h4 headers visibility
    const h4Elements = document.querySelectorAll('h4');
    h4Elements.forEach(h4 => {
        if (h4.textContent.includes('Perspective')) {
            h4.style.display = projectionMode === 'perspective' ? 'block' : 'none';
        }
        if (h4.textContent.includes('Orthogonal')) {
            h4.style.display = projectionMode === 'orthogonal' ? 'block' : 'none';
        }
    });
}

// Convert hex color to normalized RGB
function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Calculate projection matrix based on current settings
function updateProjectionMatrix() {
    const aspect = canvas.width / canvas.height;
    
    if (projectionMode === 'perspective') {
        projectionMatrix = perspective(fov, aspect, nearPlane, farPlane);
    } else {
        projectionMatrix = ortho(orthoLeft, orthoRight, orthoBottom, orthoTop, nearPlane, farPlane);
    }
    
    gl.uniformMatrix4fv(projectionMatrixLoc, false, flatten(projectionMatrix));
}

// Camera preset functions
function setCameraPreset(preset) {
    switch(preset) {
        case 'front':
            eyeX = 0; eyeY = 0; eyeZ = 3;
            atX = 0; atY = 0; atZ = 0;
            upX = 0; upY = 1; upZ = 0;
            break;
        case 'back':
            eyeX = 0; eyeY = 0; eyeZ = -3;
            atX = 0; atY = 0; atZ = 0;
            upX = 0; upY = 1; upZ = 0;
            break;
        case 'top':
            eyeX = 0; eyeY = 3; eyeZ = 0;
            atX = 0; atY = 0; atZ = 0;
            upX = 0; upY = 0; upZ = -1;
            break;
        case 'bottom':
            eyeX = 0; eyeY = -3; eyeZ = 0;
            atX = 0; atY = 0; atZ = 0;
            upX = 0; upY = 0; upZ = 1;
            break;
        case 'left':
            eyeX = -3; eyeY = 0; eyeZ = 0;
            atX = 0; atY = 0; atZ = 0;
            upX = 0; upY = 1; upZ = 0;
            break;
        case 'right':
            eyeX = 3; eyeY = 0; eyeZ = 0;
            atX = 0; atY = 0; atZ = 0;
            upX = 0; upY = 1; upZ = 0;
            break;
        case 'isometric':
            eyeX = 2; eyeY = 2; eyeZ = 2;
            atX = 0; atY = 0; atZ = 0;
            upX = 0; upY = 1; upZ = 0;
            break;
    }
    updateCameraUI();
}

// Update camera UI values
function updateCameraUI() {
    const cameraValues = {
        'eye-x': eyeX, 'eye-y': eyeY, 'eye-z': eyeZ,
        'at-x': atX, 'at-y': atY, 'at-z': atZ,
        'up-x': upX, 'up-y': upY, 'up-z': upZ
    };
    
    Object.entries(cameraValues).forEach(([id, value]) => {
        const slider = document.getElementById(id);
        const span = document.getElementById(id + '-value');
        if (slider && span) {
            slider.value = value;
            span.textContent = value.toFixed(1);
        }
    });
}

function setupEventListeners() {
    // Projection mode controls
    const projModeSelect = document.getElementById('projection-mode');
    if (projModeSelect) {
        projModeSelect.addEventListener('change', (e) => {
            projectionMode = e.target.value;
            updateProjectionMatrix();
            updateProjectionUI();
        });
    }
    
    // Perspective controls
    const perspectiveControls = [
        { id: 'fov', variable: 'fov', suffix: '°' },
        { id: 'near-plane', variable: 'nearPlane', suffix: '' },
        { id: 'far-plane', variable: 'farPlane', suffix: '' }
    ];
    
    perspectiveControls.forEach(control => {
        const slider = document.getElementById(control.id);
        const span = document.getElementById(control.id + '-value');
        if (slider && span) {
            slider.addEventListener('input', () => {
                const value = parseFloat(slider.value);
                if (control.variable === 'fov') fov = value;
                else if (control.variable === 'nearPlane') nearPlane = value;
                else if (control.variable === 'farPlane') farPlane = value;
                
                span.textContent = value.toFixed(control.id === 'fov' ? 0 : 1) + control.suffix;
                updateProjectionMatrix();
            });
        }
    });
    
    // Orthogonal controls
    const orthoControls = [
        { id: 'ortho-left', variable: 'orthoLeft' },
        { id: 'ortho-right', variable: 'orthoRight' },
        { id: 'ortho-bottom', variable: 'orthoBottom' },
        { id: 'ortho-top', variable: 'orthoTop' }
    ];
    
    orthoControls.forEach(control => {
        const slider = document.getElementById(control.id);
        const span = document.getElementById(control.id + '-value');
        if (slider && span) {
            slider.addEventListener('input', () => {
                const value = parseFloat(slider.value);
                if (control.variable === 'orthoLeft') orthoLeft = value;
                else if (control.variable === 'orthoRight') orthoRight = value;
                else if (control.variable === 'orthoBottom') orthoBottom = value;
                else if (control.variable === 'orthoTop') orthoTop = value;
                
                span.textContent = value.toFixed(1);
                updateProjectionMatrix();
            });
        }
    });
    
    // Camera position controls
    const cameraControls = [
        { id: 'eye-x', variable: 'eyeX' },
        { id: 'eye-y', variable: 'eyeY' },
        { id: 'eye-z', variable: 'eyeZ' },
        { id: 'at-x', variable: 'atX' },
        { id: 'at-y', variable: 'atY' },
        { id: 'at-z', variable: 'atZ' },
        { id: 'up-x', variable: 'upX' },
        { id: 'up-y', variable: 'upY' },
        { id: 'up-z', variable: 'upZ' }
    ];
    
    cameraControls.forEach(control => {
        const slider = document.getElementById(control.id);
        const span = document.getElementById(control.id + '-value');
        if (slider && span) {
            slider.addEventListener('input', () => {
                const value = parseFloat(slider.value);
                if (control.variable === 'eyeX') eyeX = value;
                else if (control.variable === 'eyeY') eyeY = value;
                else if (control.variable === 'eyeZ') eyeZ = value;
                else if (control.variable === 'atX') atX = value;
                else if (control.variable === 'atY') atY = value;
                else if (control.variable === 'atZ') atZ = value;
                else if (control.variable === 'upX') upX = value;
                else if (control.variable === 'upY') upY = value;
                else if (control.variable === 'upZ') upZ = value;
                
                span.textContent = value.toFixed(1);
            });
        }
    });
    
    document.getElementById('animate-btn').onclick = () => {
        isAnimating = !isAnimating;
        animationTime = 0;
        document.getElementById('animate-btn').textContent = isAnimating ? 'Stop Animation' : 'Start Animation';
    };
    document.getElementById('animation-preset').onchange = (e) => animationPreset = e.target.value;
    const sliders = ['scale', 'position-x', 'position-y', 'position-z', 'rotation-x', 'rotation-y', 'rotation-z'];
    sliders.forEach(id => {
        const slider = document.getElementById(id);
        const span = document.getElementById(id + '-value');
        if (slider && span) {
             slider.addEventListener('input', () => {
                const value = parseFloat(slider.value);
                span.textContent = id.includes('rot') ? value.toFixed(0) : value.toFixed(2);
            });
        }
    });

    // Initialize camera control values
    const cameraSliders = ['eye-x', 'eye-y', 'eye-z', 'at-x', 'at-y', 'at-z', 'up-x', 'up-y', 'up-z'];
    cameraSliders.forEach(id => {
        const slider = document.getElementById(id);
        const span = document.getElementById(id + '-value');
        if (slider && span) {
            slider.addEventListener('input', () => {
                const value = parseFloat(slider.value);
                span.textContent = value.toFixed(1);
            });
        }
    });

    // Setup responsive canvas
    setupResponsiveCanvas();
}

function setupResponsiveCanvas() {
    function resizeCanvas() {
        const canvasContainer = canvas.parentElement;
        const rect = canvasContainer.getBoundingClientRect();
        
        // Calculate the size based on container and screen size
        let size = Math.min(rect.width - 20, window.innerHeight * 0.7, 800);
        
        // Ensure minimum size for usability
        size = Math.max(size, 350);
        
        // Update canvas dimensions
        canvas.width = size;
        canvas.height = size;
        
        // Update CSS size to match
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
        
        // Update WebGL viewport
        gl.viewport(0, 0, canvas.width, canvas.height);
        
        // Update projection matrix with new aspect ratio
        updateProjectionMatrix();
    }
    
    // Initial resize
    resizeCanvas();
    
    // Listen for window resize events
    window.addEventListener('resize', resizeCanvas);
    
    // Listen for orientation change on mobile
    window.addEventListener('orientationchange', function() {
        setTimeout(resizeCanvas, 100);
    });
}

// Photo Carousel Functionality
class PhotoCarousel {
    constructor() {
        this.currentIndex = 0;
        this.images = document.querySelectorAll('.carousel-image');
        this.indicators = document.querySelectorAll('.indicator');
        this.prevBtn = document.getElementById('prev-btn');
        this.nextBtn = document.getElementById('next-btn');
        this.photoCounter = document.getElementById('current-photo');
        this.totalImages = this.images.length;
        
        this.init();
    }
    
    init() {
        // Add event listeners
        this.prevBtn.addEventListener('click', () => this.previousImage());
        this.nextBtn.addEventListener('click', () => this.nextImage());
        
        // Add indicator click handlers
        this.indicators.forEach((indicator, index) => {
            indicator.addEventListener('click', () => this.goToImage(index));
        });
        
        // Add keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                this.previousImage();
            } else if (e.key === 'ArrowRight') {
                this.nextImage();
            }
        });
        
        // Add touch/swipe support
        this.addTouchSupport();
        
        // Auto-play (optional - uncomment if needed)
        // this.startAutoPlay();
    }
    
    nextImage() {
        this.currentIndex = (this.currentIndex + 1) % this.totalImages;
        this.updateCarousel();
    }
    
    previousImage() {
        this.currentIndex = (this.currentIndex - 1 + this.totalImages) % this.totalImages;
        this.updateCarousel();
    }
    
    goToImage(index) {
        this.currentIndex = index;
        this.updateCarousel();
    }
    
    updateCarousel() {
        // Update images
        this.images.forEach((img, index) => {
            img.classList.toggle('active', index === this.currentIndex);
        });
        
        // Update indicators
        this.indicators.forEach((indicator, index) => {
            indicator.classList.toggle('active', index === this.currentIndex);
        });
        
        // Update counter
        this.photoCounter.textContent = this.currentIndex + 1;
    }
    
    addTouchSupport() {
        const container = document.querySelector('.carousel-container');
        let startX = 0;
        let startY = 0;
        let threshold = 50; // minimum distance for a swipe
        
        container.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });
        
        container.addEventListener('touchend', (e) => {
            if (!startX || !startY) return;
            
            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            
            const deltaX = startX - endX;
            const deltaY = startY - endY;
            
            // Check if horizontal swipe is longer than vertical
            if (Math.abs(deltaX) > Math.abs(deltaY)) {
                if (Math.abs(deltaX) > threshold) {
                    if (deltaX > 0) {
                        this.nextImage(); // Swipe left - next image
                    } else {
                        this.previousImage(); // Swipe right - previous image
                    }
                }
            }
            
            // Reset values
            startX = 0;
            startY = 0;
        }, { passive: true });
    }
    
    startAutoPlay() {
        setInterval(() => {
            this.nextImage();
        }, 5000); // Change image every 5 seconds
    }
}

// Initialize carousel when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new PhotoCarousel();
});

// Also initialize if DOM is already loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new PhotoCarousel();
    });
} else {
    new PhotoCarousel();
}