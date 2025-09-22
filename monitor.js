"use strict";

var canvas;
var gl;
var program;

var modelViewMatrix, projectionMatrix;
var modelViewMatrixLoc, projectionMatrixLoc;

var vertices = [];
var vertexColors = [];
var indices = [];

// Variabel Animasi
var isAnimating = false;
var animationPreset = 'spin';
var animationTime = 0;

// Rotasi via mouse
var isDragging = false;
var lastMouseX = 0, lastMouseY = 0;
var mouseRotX = 0, mouseRotY = 0; // derajat tambahan dari drag
var mouseSensitivity = 0.4; // derajat per piksel

init();

function init() {
    canvas = document.getElementById("gl-canvas");
    gl = canvas.getContext('webgl2');
    if (!gl) alert("WebGL 2.0 isn't available");

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.enable(gl.DEPTH_TEST);

    program = initShaders(gl, "vertex-shader", "fragment-shader");
    gl.useProgram(program);
    
    createDetailedMonitorModel();

    setupBuffers();

    modelViewMatrixLoc = gl.getUniformLocation(program, "modelViewMatrix");
    projectionMatrixLoc = gl.getUniformLocation(program, "projectionMatrix");

    projectionMatrix = perspective(50.0, canvas.width / canvas.height, 0.1, 100.0);
    gl.uniformMatrix4fv(projectionMatrixLoc, false, flatten(projectionMatrix));

    setupEventListeners();
    render();
}

function createDetailedMonitorModel() {
    const bezelColor = vec4(0.2, 0.2, 0.2, 1.0);
    const panelColor = vec4(0.05, 0.05, 0.05, 1.0);
    const standColor = vec4(0.15, 0.15, 0.15, 1.0);
    const baseColor = vec4(0.2, 0.2, 0.2, 1.0);

    const screenWidth = 0.7;
    const screenHeight = 0.42;
    const screenDepthFront = 0.02;
    const screenDepthBack = 0.05;
    const yOffset = 0.15;

    // Tambahkan sisi kiri/kanan sebagai ketebalan (side rectangles)
    const sideThickness = 0.005; // ketebalan sisi (arah X)
    const frameDepth = screenDepthFront; // rentang kedalaman dari depan ke belakang
    const frameCenterZ = (screenDepthFront - screenDepthBack) / 2 + 0.02; // pusat kubus agar menjangkau depan+belakang

    // Sisi kiri
    createCube(
        sideThickness,
        screenHeight - 0.01,
        frameDepth,
        bezelColor,
        -screenWidth / 2 - sideThickness / 2,
        yOffset,
        frameCenterZ
    );
    // Sisi kanan
    createCube(
        sideThickness,
        screenHeight - 0.01,
        frameDepth,
        bezelColor,
        screenWidth / 2 + sideThickness / 2,
        yOffset,
        frameCenterZ
    );

    // 1. Buat Bingkai Depan (Bezel) dan Panel Layar
    createCubeFace(screenWidth, screenHeight, screenDepthFront, bezelColor, 0, yOffset, 0);
    createCubeFace(screenWidth * 0.92, screenHeight * 0.88, screenDepthFront + 0.001, panelColor, 0, yOffset, 0);

    // 2. Buat Panel Belakang yang Melengkung
    createCurvedBackPanel(screenWidth, screenHeight, screenDepthBack, bezelColor, 0, yOffset, 0);

    // 3. Tiang dan Alas
    const standHeight = 0.2;
    const standYPos = yOffset - (screenHeight / 2) - (standHeight / 2);
    // Tiang berlubang (lubang lingkaran di tengah)
    createBoxWithCylindricalHoleRotated(
        0.2, 0.35, 0.03,
        0.05,               // radius lubang
        standColor,          // warna luar
        standColor,          // warna dinding dalam lubang
        0,
        standYPos + (standHeight / 2) - 0.05,
        -screenDepthBack * 1.7,
        -20, 0, 0,
        50                   // segments untuk keluwesan lingkaran
    );
    
    // --- PERUBAHAN DI SINI ---
    const baseYPos = standYPos - (standHeight / 2) - 0.015;
    // PANGGIL createCube() UNTUK ALAS PERSEGI PANJANG
    // Parameter: lebar(X), tinggi(Y), tebal(Z), warna, posisi pusat X, Y, Z
    createCube(0.4, 0.03, 0.3, baseColor, 0, baseYPos, -screenDepthBack * 0.5);
}

function createCube(width, height, depth, color, cx, cy, cz) {
    const w = width / 2;
    const h = height / 2;
    const d = depth / 2;

    const v = [
        vec3(-w + cx, -h + cy, d + cz), // 0
        vec3( w + cx, -h + cy, d + cz), // 1
        vec3( w + cx,  h + cy, d + cz), // 2
        vec3(-w + cx,  h + cy, d + cz), // 3
        vec3(-w + cx, -h + cy, -d + cz),// 4
        vec3( w + cx, -h + cy, -d + cz),// 5
        vec3( w + cx,  h + cy, -d + cz),// 6
        vec3(-w + cx,  h + cy, -d + cz) // 7
    ];
    
    const startIndex = vertices.length;
    vertices.push(...v);
    for (let i = 0; i < 8; i++) vertexColors.push(color);

    const cubeIndices = [
        0, 1, 2, 0, 2, 3, // Depan
        4, 5, 6, 4, 6, 7, // Belakang
        3, 2, 6, 3, 6, 7, // Atas
        0, 1, 5, 0, 5, 4, // Bawah
        4, 0, 3, 4, 3, 7, // Kiri
        1, 5, 6, 1, 6, 2  // Kanan
    ];

    for (const index of cubeIndices) {
        indices.push(startIndex + index);
    }
}

// Versi kubus yang dapat diputar secara lokal (sekitar pusatnya)
// rotX/rotY/rotZ dalam derajat
function createCubeRotated(width, height, depth, color, cx, cy, cz, rotX, rotY, rotZ) {
    const w = width / 2;
    const h = height / 2;
    const d = depth / 2;

    // Definisikan verteks relatif terhadap pusat (0,0,0)
    const localVerts = [
        vec3(-w, -h,  d), // 0
        vec3( w, -h,  d), // 1
        vec3( w,  h,  d), // 2
        vec3(-w,  h,  d), // 3
        vec3(-w, -h, -d), // 4
        vec3( w, -h, -d), // 5
        vec3( w,  h, -d), // 6
        vec3(-w,  h, -d)  // 7
    ];

    // Bangun matriks rotasi lokal: apply X kemudian Y kemudian Z
    let R = mat4();
    R = mult(R, rotate(rotX, vec3(1, 0, 0)));
    R = mult(R, rotate(rotY, vec3(0, 1, 0)));
    R = mult(R, rotate(rotZ, vec3(0, 0, 1)));

    const startIndex = vertices.length;
    for (let i = 0; i < localVerts.length; i++) {
        const v = localVerts[i];
        const v4 = vec4(v[0], v[1], v[2], 1.0);
        const r = mult(R, v4);
        vertices.push(vec3(r[0] + cx, r[1] + cy, r[2] + cz));
        vertexColors.push(color);
    }

    const cubeIndices = [
        0, 1, 2, 0, 2, 3, // Depan
        4, 5, 6, 4, 6, 7, // Belakang
        3, 2, 6, 3, 6, 7, // Atas
        0, 1, 5, 0, 5, 4, // Bawah
        4, 0, 3, 4, 3, 7, // Kiri
        1, 5, 6, 1, 6, 2  // Kanan
    ];

    for (const index of cubeIndices) {
        indices.push(startIndex + index);
    }
}

// Kotak/box dengan lubang silinder tembus di tengah (sepanjang sumbu Z lokal), lalu diputar secara lokal.
// width=X, height=Y, depth=Z, holeRadius=radius lubang, rotX/Y/Z dalam derajat, segments=jumlah segmen lingkaran
function createBoxWithCylindricalHoleRotated(width, height, depth, holeRadius, colorOuter, colorInner, cx, cy, cz, rotX, rotY, rotZ, segments) {
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

    const startIndex = vertices.length;

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

    const idx = [];

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

/**
 * Membuat hanya sisi depan dari sebuah balok (untuk panel layar)
 */
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

// ####################################################################
// ## FUNGSI YANG HILANG SEBELUMNYA, SEKARANG SUDAH ADA DI SINI ##
// ####################################################################
/**
 * FUNGSI BARU: Membuat panel belakang melengkung & menyambungkannya
 */
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
    // Dinding Kiri
    indices.push(frontStartIndex+0, frontStartIndex+3, startIndex + segments*(segments+1));
    indices.push(frontStartIndex+0, startIndex + segments*(segments+1), startIndex);
    // Dinding Kanan
    indices.push(frontStartIndex+1, frontStartIndex+2, startIndex + segments*(segments+1) + segments);
    indices.push(frontStartIndex+1, startIndex + segments*(segments+1) + segments, startIndex + segments);
}


function generateCylinder(radius, height, segments, color, cx, cy, cz) {
    const h = height / 2;
    const startIndex = vertices.length;
    const topCenter = vec3(cx, cy + h, cz);
    const bottomCenter = vec3(cx, cy - h, cz);
    vertices.push(topCenter, bottomCenter);
    vertexColors.push(color, color);
    const topCenterIndex = startIndex;
    const bottomCenterIndex = startIndex + 1;
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        const x = cx + radius * Math.cos(angle);
        const z = cz + radius * Math.sin(angle);
        vertices.push(vec3(x, cy + h, z));
        vertices.push(vec3(x, cy - h, z));
        vertexColors.push(color, color);
    }
    for (let i = 0; i < segments; i++) {
        const top1 = startIndex + 2 + i * 2;
        const bottom1 = top1 + 1;
        const top2 = startIndex + 2 + (i + 1) * 2;
        const bottom2 = top2 + 1;
        indices.push(top1, bottom1, top2);
        indices.push(bottom1, bottom2, top2);
        indices.push(topCenterIndex, top1, top2);
        indices.push(bottomCenterIndex, bottom2, bottom1);
    }
}

function setupBuffers() {
    var iBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    var cBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(vertexColors), gl.STATIC_DRAW);
    var colorLoc = gl.getAttribLocation(program, "aColor");
    gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(colorLoc);
    var vBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(vertices), gl.STATIC_DRAW);
    var positionLoc = gl.getAttribLocation(program, "aPosition");
    gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(positionLoc);
}
function render() {
    const bgColor = document.getElementById('bg-color').value;
    let posX = parseFloat(document.getElementById('position-x').value);
    let posY = parseFloat(document.getElementById('position-y').value);
    let posZ = parseFloat(document.getElementById('position-z').value);
    let rotX = parseFloat(document.getElementById('rotation-x').value);
    let rotY = parseFloat(document.getElementById('rotation-y').value);
    let rotZ = parseFloat(document.getElementById('rotation-z').value);
    let scaleValue = parseFloat(document.getElementById('scale').value);
    if (isAnimating) {
        animationTime += 0.016;
        if (animationPreset === 'spin') {
            rotY = (animationTime * 50) % 360;
            document.getElementById('rotation-y').value = rotY.toFixed(0);
            document.getElementById('rotation-y-value').textContent = rotY.toFixed(0);
        } else if (animationPreset === 'bounce') {
            posY = 0.3 * Math.sin(animationTime * 4);
            document.getElementById('position-y').value = posY.toFixed(2);
            document.getElementById('position-y-value').textContent = posY.toFixed(2);
        } else if (animationPreset === 'pulse') {
            scaleValue = 1.0 + 0.2 * Math.sin(animationTime * 5);
            document.getElementById('scale').value = scaleValue.toFixed(2);
            document.getElementById('scale-value').textContent = scaleValue.toFixed(2);
        }
    }
    const rgb = hexToRgb(bgColor);
    gl.clearColor(rgb[0], rgb[1], rgb[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    let mvm = mat4();
    mvm = mult(mvm, translate(0, 0, -3));
    mvm = mult(mvm, translate(posX, posY, posZ));
    // Gabungkan rotasi slider dengan rotasi hasil drag mouse
    const finalRotY = rotY + mouseRotY;
    const finalRotX = rotX + mouseRotX;
    mvm = mult(mvm, rotate(rotZ, vec3(0, 0, 1)));
    mvm = mult(mvm, rotate(finalRotY, vec3(0, 1, 0)));
    mvm = mult(mvm, rotate(finalRotX, vec3(1, 0, 0)));
    mvm = mult(mvm, scale(scaleValue, scaleValue, scaleValue));
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(mvm));
    if (document.getElementById('wireframe-mode').checked) {
        for (let i = 0; i < indices.length; i += 3) {
            gl.drawElements(gl.LINE_LOOP, 3, gl.UNSIGNED_SHORT, i * 2);
        }
    } else {
        gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    }
    requestAnimationFrame(render);
}
function hexToRgb(hex) {
    hex = hex.replace('#', '');
    var bigint = parseInt(hex, 16);
    return [((bigint >> 16) & 255) / 255, ((bigint >> 8) & 255) / 255, (bigint & 255) / 255];
}
function setupEventListeners() {
    document.getElementById('animate-btn').onclick = () => {
        isAnimating = !isAnimating;
        animationTime = 0;
        document.getElementById('animate-btn').textContent = isAnimating ? 'Stop Animasi' : 'Mulai Animasi';
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

    // Kontrol rotasi dengan mouse pada canvas
    const cvs = canvas; // sudah diinisialisasi di init()
    if (cvs) {
        cvs.style.cursor = 'grab';
        cvs.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // hanya tombol kiri
            isDragging = true;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            cvs.style.cursor = 'grabbing';
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - lastMouseX;
            const dy = e.clientY - lastMouseY;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            mouseRotY += dx * mouseSensitivity; // yaw (kiri/kanan)
            mouseRotX += dy * mouseSensitivity; // pitch (atas/bawah)
            // Batasi pitch agar tidak terbalik
            mouseRotX = Math.max(-89, Math.min(89, mouseRotX));
        });
        const endDrag = () => { if (isDragging) { isDragging = false; cvs.style.cursor = 'grab'; } };
        window.addEventListener('mouseup', endDrag);
        cvs.addEventListener('mouseleave', endDrag);
        // Nonaktifkan menu konteks saat klik kanan di canvas
        cvs.addEventListener('contextmenu', (e) => e.preventDefault());
    }
}