"use strict";
let canvas, gl, program;
let modelViewMatrix, projectionMatrix, modelViewMatrixLoc, projectionMatrixLoc;
let vertices = [], vertexColors = [], indices = [], normals = [], shininessValues = [], texCoords = [];

// Draw partitioning for hierarchical rendering
let screenIndexCount = 0; // jumlah index untuk screen group (tilt)
let monitorIndexCount = 0; // jumlah total index untuk *seluruh* monitor (screen + stand)
let tableIndexCount = 0;   // jumlah index untuk meja
let mouseIndexCount = 0;   // Hanya badan mouse
// cableIndexCount dihapus
let tablePosX = 0;         // Posisi X untuk meja (animasi geser)
let mousePosX = 0.5, mousePosZ = 0.3; 

// Mouse part index ranges (filled in createMouse)
let mouseBaseIndexStart = 0, mouseBaseIndexCount = 0;
let mouseBodyIndexStart = 0, mouseBodyIndexCount = 0;
let mousePalmIndexStart = 0, mousePalmIndexCount = 0;
let mouseLeftIndexStart = 0, mouseLeftIndexCount = 0;
let mouseGripIndexStart = 0, mouseGripIndexCount = 0;
let mouseRightIndexStart = 0, mouseRightIndexCount = 0;
let mouseWheelIndexStart = 0, mouseWheelIndexCount = 0;

// Local pivots for mouse parts (in mouse local coordinates)
let mouseLeftPivot = vec3(0,0,0);
let mouseRightPivot = vec3(0,0,0);
let mouseWheelPivot = vec3(0,0,0);

// Mouse animation state (left and right clicks)
let mouseLeftClickAnimating = false;
let mouseLeftClickTime = 0;
let mouseRightClickAnimating = false;
let mouseRightClickTime = 0;
const mouseClickDuration = 0.6; // seconds (down+up) - made longer per request
const mouseClickDepth = 0.02; // how far button moves down on click

let mouseScrollActive = false;
let mouseWheelAngle = 0; // degrees

let tiltAngle = 0; // degrees
let screenPivotX = 0, screenPivotY = 0, screenPivotZ = 0; // pivot for tilt
let scalePivotX = 0, scalePivotY = 0, scalePivotZ = 0; // pivot for monitor scale (foot)
let isAnimating = false, animationPreset = 'spin', animationTime = 0;

// Texture variables
let checkerboardTexture, wallpaperTexture;
let useTextures = true;

// Projection control variables
let projectionMode = 'perspective';
let fov = 50, nearPlane = 0.1, farPlane = 100;
let orthoLeft = -2, orthoRight = 2, orthoBottom = -2, orthoTop = 2;

// Camera control variables
let eyeX = 0, eyeY = 0, eyeZ = 3;
let atX = 0, atY = 0, atZ = 0;
let upX = 0, upY = 1, upZ = 0;

// Mouse control variables
let mouseDown = false;
let lastMouseX = 0, lastMouseY = 0;
let mousePan = false; // true when shift+drag is active
let cameraRadius = 3;
let cameraTheta = 0; // horizontal rotation
let cameraPhi = 0;   // vertical rotation

function initializeSphericalCoords() {
    cameraRadius = Math.sqrt(eyeX * eyeX + eyeY * eyeY + eyeZ * eyeZ);
    cameraTheta = Math.atan2(eyeZ, eyeX);
    cameraPhi = Math.asin(eyeY / cameraRadius);
}

// Lighting variables
let enableLighting = true;
let lightPosition = vec3(-5.0, 5.0, 8.0);
let lightColor = vec3(0.5, 0.5, 0.5);
let ambientLight = vec3(0.4, 0.4, 0.4);
let ambientStrength = 0.25;
let diffuseStrength = 1.0;
let specularStrength = 1.2;

// Uniform locations for lighting
let lightingUniforms = {};

function loadTexture(gl, url, flipY = false) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    
    const level = 0;
    const internalFormat = gl.RGBA;
    const width = 1;
    const height = 1;
    const border = 0;
    const srcFormat = gl.RGBA;
    const srcType = gl.UNSIGNED_BYTE;
    const pixel = new Uint8Array([0, 0, 255, 255]);
    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, width, height, border, srcFormat, srcType, pixel);
    
    const image = new Image();
    image.onload = function() {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
        gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, srcFormat, srcType, image);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        
        if (isPowerOf2(image.width) && isPowerOf2(image.height)) {
            gl.generateMipmap(gl.TEXTURE_2D);
        } else {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }
    };
    image.src = url;
    
    return texture;
}

function isPowerOf2(value) {
    return (value & (value - 1)) == 0;
}

init();

function init() {
    canvas = document.getElementById("gl-canvas");
    gl = canvas.getContext('webgl2');
    if (!gl) alert("WebGL 2.0 isn't available");

    gl.clearColor(1, 1, 1, 1);
    gl.enable(gl.DEPTH_TEST);

    program = initShaders(gl, "vertex-shader", "fragment-shader");
    gl.useProgram(program);

    // Ambil nilai awal mouse dari slider HTML
    mousePosX = parseFloat(document.getElementById('mouse-pos-x').value);
    mousePosZ = parseFloat(document.getElementById('mouse-pos-z').value);

    // Hierarchy loading
    // 1. Buat Monitor (Screen + Stand)
    createMonitor();
    monitorIndexCount = indices.length; 
    
    // 2. Buat Meja
    createTable();
    tableIndexCount = indices.length - monitorIndexCount;
    
    // 3. Buat Mouse (HANYA BADAN)
    createMouse();
    mouseIndexCount = indices.length - monitorIndexCount - tableIndexCount;
    
    // 4. (Tidak ada kabel terpisah)
    // ---

    setupBuffers();

    // Load textures
    checkerboardTexture = loadTexture(gl, 'checkerboard.jpg', false);
    wallpaperTexture = loadTexture(gl, 'wallpaper.jpg', true);

    modelViewMatrixLoc = gl.getUniformLocation(program, "modelViewMatrix");
    projectionMatrixLoc = gl.getUniformLocation(program, "projectionMatrix");
    
    // Get lighting uniform locations
    lightingUniforms = {
        enableLighting: gl.getUniformLocation(program, "enableLighting"),
        lightPosition: gl.getUniformLocation(program, "lightPosition"),
        lightColor: gl.getUniformLocation(program, "lightColor"),
        ambientLight: gl.getUniformLocation(program, "ambientLight"),
        eyePosition: gl.getUniformLocation(program, "eyePosition"),
        ambientStrength: gl.getUniformLocation(program, "ambientStrength"),
        diffuseStrength: gl.getUniformLocation(program, "diffuseStrength"),
        specularStrength: gl.getUniformLocation(program, "specularStrength"),
        normalMatrix: gl.getUniformLocation(program, "normalMatrix"),
        useTextures: gl.getUniformLocation(program, "useTextures"),
        checkerboardTexture: gl.getUniformLocation(program, "checkerboardTexture"),
        wallpaperTexture: gl.getUniformLocation(program, "wallpaperTexture")
    };
    
    initializeSphericalCoords();
    setupEventListeners();
    
    // Initialize projection matrix and UI
    updateProjectionMatrix();
    updateProjectionUI();
    
    render();
}

// Table geometry
function createTable() {
    
    const darkWoodColor = vec4(0.3, 0.2, 0.15, 1.0); 
    const whitePanelColor = vec4(0.95, 0.95, 0.95, 1.0);
    const bodyShininess = 3.0;

    // Dimensi Atas Meja
    const tableTopWidth = 2.0;
    const tableTopHeight = 0.05;
    const tableTopDepth = 1.0;
    const tableTopY = -0.29 - (tableTopHeight / 2); // Center Y = -0.315
    
    // Dimensi Panel Kaki Samping (Tebal, menghadap samping)
    const panelHeight = 0.7; // TINGGI PENUH KAKI
    const panelY = tableTopY - (tableTopHeight / 2) - (panelHeight / 2); // Center Y = -0.69
    const sidePanelThickness = 0.04; // tebal di X
    const sidePanelDepth = 0.9;      // dalam di Z
    const sidePanelXOffset = (tableTopWidth / 2) - (sidePanelThickness / 2) - 0.05; // 0.93

    // 1. Permukaan Atas Meja (Coklat Tua)
    createCubeWithShininess(tableTopWidth, tableTopHeight, tableTopDepth, darkWoodColor, 0, tableTopY, 0, bodyShininess);
    
    // 2. Panel Kaki Kiri (Coklat Tua, menghadap samping)
    createCubeWithShininess(sidePanelThickness, panelHeight, sidePanelDepth, darkWoodColor, -sidePanelXOffset, panelY, 0, bodyShininess); 
    
    // 3. Panel Kaki Kanan (Coklat Tua, menghadap samping)
    createCubeWithShininess(sidePanelThickness, panelHeight, sidePanelDepth, darkWoodColor, sidePanelXOffset, panelY, 0, bodyShininess);
    
    // Front panels
    const frontPanelThickness = 0.02; // KETEBALAN TIPIS di Z (untuk panel putih & coklat)
    const frontPanelZ = (-sidePanelDepth / 2) + 0.1 + (frontPanelThickness / 2); // -0.34
    
    // Tepi dalam panel kiri
    const leftInnerEdge = -sidePanelXOffset + (sidePanelThickness / 2); // -0.91
    // Tepi dalam panel kanan
    const rightInnerEdge = sidePanelXOffset - (sidePanelThickness / 2); // 0.91
    
    // Hitung total lebar ruang antar kaki
    const totalInnerWidth = rightInnerEdge - leftInnerEdge; // 0.91 - (-0.91) = 1.82

    // 4. Panel Putih (Horizontal, Pendek)
    const whitePanelWidth = 1.2;
    const whitePanelHeight = panelHeight * 0.9; // Sedikit lebih pendek dari tinggi penuh
    const whitePanelY = panelY - (panelHeight - whitePanelHeight) / 2; // Posis Y sedikit ke atas
    
    const whitePanelCenterX = leftInnerEdge + (whitePanelWidth / 2); // -0.91 + 0.6 = -0.31
    createCubeWithShininess(
        whitePanelWidth,      // Lebar (Horizontal)
        whitePanelHeight,     // Tinggi (Pendek)
        frontPanelThickness,  // Kedalaman (Tipis)
        whitePanelColor,
        whitePanelCenterX,    // X
        whitePanelY,          // Y (Agak ke atas)
        frontPanelZ,          // Z (Di depan)
        bodyShininess
    );
    
    // 5. Panel Sekat Coklat (Vertikal, Penuh, Tipis)
    // Hitung sisa lebar yang harus diisi oleh panel coklat
    const brownPanelWidth = totalInnerWidth - whitePanelWidth; // 1.82 - 1.2 = 0.62
    
    // Tepi kanan panel putih
    const whitePanelRightEdge = whitePanelCenterX + (whitePanelWidth / 2); // 0.29
    
    // Center X-nya
    const brownPanelCenterX = whitePanelRightEdge + (brownPanelWidth / 2); // 0.29 + (0.62 / 2) = 0.60
    
    createCubeWithShininess(
        brownPanelWidth,       // Lebar (0.62, hasil hitungan)
        panelHeight,           // Tinggi (PENUH, 0.7, sama dgn kaki)
        frontPanelThickness,   // Kedalaman (TIPIS, 0.02, sama dgn putih)
        darkWoodColor,         // Warna coklat
        brownPanelCenterX,     // X (Sebelah putih, 0.60)
        panelY,                // Y (Center sama dgn kaki)
        frontPanelZ,           // Z (Di depan, sama dgn putih)
        bodyShininess
    );
}
// ---

// Mouse geometry
function createMouse() {
    const mouseColor = vec4(0.1, 0.1, 0.1, 1.0);
    const wheelColor = vec4(0.2, 0.2, 0.2, 1.0);
    const mouseShininess = 10.0;

    // Model mouse dibuat dari tumpukan 4 kubus
    // Semua Y dihitung dari 0 (alas)
    
    // 1. Alas (paling bawah, paling besar)
    const baseHeight = 0.005;
    const baseY = 0;
    const baseWidth = 0.08;
    const baseDepth = 0.12;
    let idxStart = indices.length;
    createCubeWithShininess(baseWidth, baseHeight, baseDepth, mouseColor, 0, baseY + baseHeight/2, 0, mouseShininess);
    mouseBaseIndexStart = idxStart;
    mouseBaseIndexCount = indices.length - idxStart;

    // 2. Badan (tengah)
    const bodyHeight = 0.01;
    const bodyY = baseY + baseHeight;
    const bodyWidth = 0.075;
    const bodyDepth = 0.11;
    idxStart = indices.length;
    createCubeWithShininess(bodyWidth, bodyHeight, bodyDepth, mouseColor, 0, bodyY + bodyHeight/2, 0, mouseShininess);
    mouseBodyIndexStart = idxStart;
    mouseBodyIndexCount = indices.length - idxStart;
    
    const palmHeight = 0.01;
    const palmY = bodyY + bodyHeight;
    const palmWidth = 0.07;
    const palmDepth = 0.06; // made the palm a bit shorter (reduced depth)
    // create palm (rear/top of mouse)
    mousePalmIndexStart = indices.length;
    createCubeWithShininess(palmWidth, palmHeight, palmDepth, mouseColor, 0, palmY + palmHeight/2, -0.02, mouseShininess);
    mousePalmIndexCount = indices.length - mousePalmIndexStart;
    idxStart = indices.length;
    // Make the scroll wheel thinner while making the clickable buttons wider
    const wheelNominalW = 0.012; // thinner wheel
    const btnWidth = 0.025; // wider click regions (longer)
    const btnDepth = 0.03; // extend button depth a bit
    const btnHeight = palmHeight; // same height as palm
    const btnZ = 0.04; // flank the scroll wheel at same Z
    const btnGap = 0.003; // slightly larger gap between wheel and buttons
    const leftOffsetX = -(btnWidth / 2 + wheelNominalW / 2 + btnGap); // left of wheel
    const rightOffsetX = -leftOffsetX; // symmetric

    // left button
    mouseLeftIndexStart = indices.length;
    createCubeWithShininess(btnWidth, btnHeight, btnDepth, mouseColor, leftOffsetX, palmY + palmHeight/2, btnZ, mouseShininess);
    mouseLeftIndexCount = indices.length - mouseLeftIndexStart;
    mouseLeftPivot = vec3(leftOffsetX, palmY + palmHeight/2, btnZ);

    // right button
    mouseRightIndexStart = indices.length;
    createCubeWithShininess(btnWidth, btnHeight, btnDepth, mouseColor, rightOffsetX, palmY + palmHeight/2, btnZ, mouseShininess);
    mouseRightIndexCount = indices.length - mouseRightIndexStart;
    mouseRightPivot = vec3(rightOffsetX, palmY + palmHeight/2, btnZ);

    // 4. Scroll Wheel (mencuat dari badan)
    const wheelHeight = 0.015;
    const wheelY = bodyY + wheelHeight/2; // Mencuat dari lapisan badan
    const wheelZ = 0.04; // Posisi Z wheel
    idxStart = indices.length;
    // create a wider wheel to match the longer click/scroll region
    createCubeWithShininess(wheelNominalW, wheelHeight, wheelNominalW, wheelColor, 0, wheelY, wheelZ, mouseShininess);
    mouseWheelIndexStart = idxStart;
    mouseWheelIndexCount = indices.length - idxStart;
    // store wheel pivot (local mouse coordinates)
    mouseWheelPivot = vec3(0, wheelY, wheelZ);

    // 5. Kabel dihapus
}
// ----------------------------------------

// Fungsi createMouseCable() dihapus


function createMonitor() {
    const bezelColor = vec4(0.2, 0.2, 0.2, 1.0);
    const panelColor = vec4(0.05, 0.05, 0.05, 1.0);
    const standColor = vec4(0.18, 0.18, 0.18, 1.0);
    const baseColor = vec4(0.18, 0.18, 0.18, 1.0);

    const screenShininess = 20.0;
    const bodyShininess = 5.0;

    const screenWidth = 0.7
    const screenHeight = 0.42
    const screenDepthFront = 0.02
    const screenDepthBack = 0.05
    const yOffset = 0.15

    const sideThickness = 0.002
    const frameDepth = screenDepthFront - 0.005
    const frameCenterZ = (screenDepthFront - screenDepthBack) / 2 + 0.02;

    createCubeWithShininess(
        sideThickness, screenHeight - 0.005, 
        frameDepth, 
        bezelColor, 
        -screenWidth / 2 - sideThickness / 2, 
        yOffset, 
        frameCenterZ,
        bodyShininess);
    createCubeWithShininess(
        sideThickness, 
        screenHeight - 0.005, 
        frameDepth, 
        bezelColor, 
        screenWidth / 2 + sideThickness / 2, 
        yOffset, 
        frameCenterZ,
        bodyShininess);
    createCubeFaceWithShininess(
        screenWidth, 
        screenHeight, 
        screenDepthFront, 
        bezelColor, 
        0, 
        yOffset, 
        0,
        bodyShininess);
    createCubeFaceWithShininess(
        screenWidth * 0.92, 
        screenHeight * 0.88, 
        screenDepthFront + 0.001, 
        panelColor, 
        0, 
        yOffset, 
        0,
        screenShininess);

    createCurvedBackPanelWithShininess(
        screenWidth, 
        screenHeight, 
        screenDepthBack, 
        bezelColor, 
        0, 
        yOffset, 
        0,
        bodyShininess);
    createCubeWithShininess(
        screenWidth,
        0.01,
        0.01,
        bezelColor,
        0,
        yOffset + (screenHeight / 2) - 0.005,
        0.005,
        bodyShininess
    );
    createCubeWithShininess(
        screenWidth,
        0.01,
        0.01,
        bezelColor,
        0,
        yOffset - (screenHeight / 2) + 0.005,
        0.005,
        bodyShininess
    );

    const standHeight = 0.2
    const standYPos = yOffset - (screenHeight / 2) - (standHeight / 2);

    // Tandai semua geometri sejauh ini sebagai bagian dari grup tilt (screen/frame)
    screenIndexCount = indices.length;
    // Tentukan pivot tilt
    screenPivotX = 0;
    screenPivotY = standYPos + (standHeight / 2);
    screenPivotZ = 0;

    // --- Mulai Geometri Stand/Base (NON-TILT) ---
    createBoxWithHoleAndShininess(
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
        50,
        bodyShininess
    );

    const baseYPos = standYPos - (standHeight / 2) - 0.015; // Ini sekitar -0.275
    // Y-bottom dari base ini adalah -0.275 - (0.03 / 2) = -0.29
    createCubeWithShininess(
        0.4, 
        0.03, // Tinggi base
        0.3, 
        baseColor, 
        0, 
        baseYPos, 
        -screenDepthBack * 0.5,
        bodyShininess
    );

    // Tentukan pivot untuk skala monitor (anchor di kaki / foot)
    // scalePivotY harus menunjuk ke posisi paling bawah dari base (world/model space)
    scalePivotX = 0;
    // base tinggi = 0.03, jadi bottom = baseYPos - 0.03/2
    scalePivotY = baseYPos - (0.03 / 2);
    // gunakan Z center dari base sebagai pivot Z
    scalePivotZ = -screenDepthBack * 0.5;
}

function createCubeWithShininess(width, height, depth, color, cx, cy, cz, shininess) {
    const w = width / 2, h = height / 2, d = depth / 2;
    
    const faceNormals = [
        vec3(0, 0, 1),   // front
        vec3(0, 0, -1),  // back  
        vec3(1, 0, 0),   // right
        vec3(-1, 0, 0),  // left
        vec3(0, 1, 0),   // top
        vec3(0, -1, 0)   // bottom
    ];
    
    const faces = [
        [vec3(-w + cx, -h + cy, d + cz), vec3(w + cx, -h + cy, d + cz), vec3(w + cx, h + cy, d + cz), vec3(-w + cx, h + cy, d + cz)],
        [vec3(w + cx, -h + cy, -d + cz), vec3(-w + cx, -h + cy, -d + cz), vec3(-w + cx, h + cy, -d + cz), vec3(w + cx, h + cy, -d + cz)],
        [vec3(w + cx, -h + cy, d + cz), vec3(w + cx, -h + cy, -d + cz), vec3(w + cx, h + cy, -d + cz), vec3(w + cx, h + cy, d + cz)],
        [vec3(-w + cx, -h + cy, -d + cz), vec3(-w + cx, -h + cy, d + cz), vec3(-w + cx, h + cy, d + cz), vec3(-w + cx, h + cy, -d + cz)],
        [vec3(-w + cx, h + cy, d + cz), vec3(w + cx, h + cy, d + cz), vec3(w + cx, h + cy, -d + cz), vec3(-w + cx, h + cy, -d + cz)],
        [vec3(-w + cx, -h + cy, -d + cz), vec3(w + cx, -h + cy, -d + cz), vec3(w + cx, -h + cy, d + cz), vec3(-w + cx, -h + cy, d + cz)]
    ];
    
    const faceTexCoords = [
        [vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)], // front
        [vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)], // back
        [vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)], // right
        [vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)], // left
        [vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)], // top
        [vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)]  // bottom
    ];
    
    faces.forEach((faceVertices, faceIndex) => {
        const startIndex = vertices.length;
        
        faceVertices.forEach((vertex, vertexIndex) => {
            vertices.push(vertex);
            vertexColors.push(color);
            normals.push(faceNormals[faceIndex]);
            shininessValues.push(shininess);
            texCoords.push(faceTexCoords[faceIndex][vertexIndex]);
        });
        
        indices.push(startIndex, startIndex + 1, startIndex + 2);
        indices.push(startIndex, startIndex + 2, startIndex + 3);
    });
}

function createCubeFaceWithShininess(width, height, depth, color, cx, cy, cz, shininess) {
    const w = width / 2;
    const h = height / 2;
    const d = depth / 2;

    const v = [
        vec3(-w + cx, -h + cy, d + cz),
        vec3( w + cx, -h + cy, d + cz),
        vec3( w + cx,  h + cy, d + cz),
        vec3(-w + cx,  h + cy, d + cz),
    ];
    
    const texCoordsFace = [
        vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)
    ];
    
    const faceNormal = vec3(0, 0, 1);
    
    const startIndex = vertices.length;
    vertices.push(...v);
    for (let i = 0; i < 4; i++) {
        vertexColors.push(color);
        normals.push(faceNormal);
        shininessValues.push(shininess);
        texCoords.push(texCoordsFace[i]);
    }

    const faceIndices = [0, 1, 2, 0, 2, 3];
    for (const index of faceIndices) {
        indices.push(startIndex + index);
    }
}

function createCurvedBackPanelWithShininess(width, height, maxDepth, color, cx, cy, cz, shininess) {
    const w = width / 2;
    const h = height / 2;
    const segments = 20;

    const startIndex = vertices.length;
    const backVertices = [];
    const backNormals = [];
    const backTexCoords = [];
    
    for (let j = 0; j <= segments; j++) {
        for (let i = 0; i <= segments; i++) {
            const u = i / segments;
            const v = j / segments;

            const x = cx + (u * width) - w;
            const y = cy + (v * height) - h;
            const z = cz - (maxDepth * Math.cos((u - 0.5) * Math.PI));
            
            backVertices.push(vec3(x, y, z));
            backTexCoords.push(vec2(u, v));
            
            const dz_du = maxDepth * Math.sin((u - 0.5) * Math.PI) * Math.PI;
            const tangentU = vec3(width, 0, dz_du);
            const tangentV = vec3(0, height, 0);
            const normal = normalize(cross(tangentU, tangentV));
            backNormals.push(normal);
        }
    }
    
    vertices.push(...backVertices);
    for (let i = 0; i < backVertices.length; i++) {
        vertexColors.push(color);
        normals.push(backNormals[i]);
        shininessValues.push(shininess);
        texCoords.push(backTexCoords[i]);
    }

    for (let j = 0; j < segments; j++) {
        for (let i = 0; i < segments; i++) {
            const row1 = j * (segments + 1);
            const row2 = (j + 1) * (segments + 1);
            indices.push(startIndex + row1 + i, startIndex + row1 + i + 1, startIndex + row2 + i + 1);
            indices.push(startIndex + row1 + i, startIndex + row2 + i + 1, startIndex + row2 + i);
        }
    }
}

function createBoxWithHoleAndShininess(width, height, depth, holeRadius, colorOuter, colorInner, cx, cy, cz, rotX, rotY, rotZ, segments, shininess) {
    segments = segments || 32;
    const w = width / 2;
    const h = height / 2;
    const d = depth / 2;
    const r = Math.min(holeRadius, 0.49 * Math.min(width, height));

    let R = mat4();
    R = mult(R, rotate(rotX, vec3(1, 0, 0)));
    R = mult(R, rotate(rotY, vec3(0, 1, 0)));
    R = mult(R, rotate(rotZ, vec3(0, 0, 1)));

    const frontCircle = [];
    const backCircle = [];
    const frontRays = [];
    const backRays = [];

    for (let i = 0; i < segments; i++) {
        const t = (i / segments) * 2 * Math.PI;
        const dx = Math.cos(t);
        const dy = Math.sin(t);

        frontCircle.push(vec3(r * dx, r * dy, d));
        backCircle.push(vec3(r * dx, r * dy, -d));

        const sx = dx === 0 ? Infinity : w / Math.abs(dx);
        const sy = dy === 0 ? Infinity : h / Math.abs(dy);
        const s = Math.min(sx, sy);
        const rx = dx * s;
        const ry = dy * s;
        frontRays.push(vec3(rx, ry, d));
        backRays.push(vec3(rx, ry, -d));
    }

    function pushVWithShininess(v3, color, normal, texCoord = vec2(0, 0)) {
        const v4 = vec4(v3[0], v3[1], v3[2], 1.0);
        const r4 = mult(R, v4);
        const rotatedNormal = mult(R, vec4(normal[0], normal[1], normal[2], 0.0));
        vertices.push(vec3(r4[0] + cx, r4[1] + cy, r4[2] + cz));
        vertexColors.push(color);
        normals.push(vec3(rotatedNormal[0], rotatedNormal[1], rotatedNormal[2]));
        shininessValues.push(shininess);
        texCoords.push(texCoord);
    }

    const baseFrontCircle = vertices.length;
    for (let i = 0; i < segments; i++) {
        const t = (i / segments) * 2 * Math.PI;
        const u = (Math.cos(t) + 1) * 0.5;
        const v = (Math.sin(t) + 1) * 0.5;
        pushVWithShininess(frontCircle[i], colorOuter, vec3(0, 0, 1), vec2(u, v));
    }
    const baseBackCircle = vertices.length;
    for (let i = 0; i < segments; i++) {
        const t = (i / segments) * 2 * Math.PI;
        const u = (Math.cos(t) + 1) * 0.5;
        const v = (Math.sin(t) + 1) * 0.5;
        pushVWithShininess(backCircle[i], colorOuter, vec3(0, 0, -1), vec2(u, v));
    }
    const baseFrontRays = vertices.length;
    for (let i = 0; i < segments; i++) {
        const t = (i / segments) * 2 * Math.PI;
        const u = (Math.cos(t) + 1) * 0.5;
        const v = (Math.sin(t) + 1) * 0.5;
        pushVWithShininess(frontRays[i], colorOuter, vec3(0, 0, 1), vec2(u, v));
    }
    const baseBackRays = vertices.length;
    for (let i = 0; i < segments; i++) {
        const t = (i / segments) * 2 * Math.PI;
        const u = (Math.cos(t) + 1) * 0.5;
        const v = (Math.sin(t) + 1) * 0.5;
        pushVWithShininess(backRays[i], colorOuter, vec3(0, 0, -1), vec2(u, v));
    }

    for (let i = 0; i < segments; i++) {
        const i1 = (i + 1) % segments;
        const c0 = baseFrontCircle + i;
        const c1 = baseFrontCircle + i1;
        const r0 = baseFrontRays + i;
        const r1 = baseFrontRays + i1;
        indices.push(c0, c1, r1);
        indices.push(c0, r1, r0);
    }

    for (let i = 0; i < segments; i++) {
        const i1 = (i + 1) % segments;
        const c0 = baseBackCircle + i;
        const c1 = baseBackCircle + i1;
        const r0 = baseBackRays + i;
        const r1 = baseBackRays + i1;
        indices.push(c0, r1, c1);
        indices.push(c0, r0, r1);
    }

    const baseInnerFront = vertices.length;
    for (let i = 0; i < segments; i++) {
        const t = (i / segments) * 2 * Math.PI;
        const inwardNormal = vec3(-Math.cos(t), -Math.sin(t), 0);
        const u = (Math.cos(t) + 1) * 0.5;
        const v = (Math.sin(t) + 1) * 0.5;
        pushVWithShininess(frontCircle[i], colorInner, inwardNormal, vec2(u, v));
    }
    const baseInnerBack = vertices.length;
    for (let i = 0; i < segments; i++) {
        const t = (i / segments) * 2 * Math.PI;
        const inwardNormal = vec3(-Math.cos(t), -Math.sin(t), 0);
        const u = (Math.cos(t) + 1) * 0.5;
        const v = (Math.sin(t) + 1) * 0.5;
        pushVWithShininess(backCircle[i], colorInner, inwardNormal, vec2(u, v));
    }
    for (let i = 0; i < segments; i++) {
        const i1 = (i + 1) % segments;
        const f0 = baseInnerFront + i;
        const f1 = baseInnerFront + i1;
        const b0 = baseInnerBack + i;
        const b1 = baseInnerBack + i1;
        indices.push(f0, b0, b1);
        indices.push(f0, b1, f1);
    }

    function addQuadWithShininess(v0, v1, v2, v3, color, normal) {
        const s = vertices.length;
        const quadTexCoords = [vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)];
        pushVWithShininess(v0, color, normal, quadTexCoords[0]); 
        pushVWithShininess(v1, color, normal, quadTexCoords[1]); 
        pushVWithShininess(v2, color, normal, quadTexCoords[2]); 
        pushVWithShininess(v3, color, normal, quadTexCoords[3]);
        indices.push(s + 0, s + 1, s + 2);
        indices.push(s + 0, s + 2, s + 3);
    }
    
    addQuadWithShininess(vec3(-w, -h,  d), vec3(-w, -h, -d), vec3(-w,  h, -d), vec3(-w,  h,  d), colorOuter, vec3(-1, 0, 0));
    addQuadWithShininess(vec3( w, -h,  d), vec3( w,  h,  d), vec3( w,  h, -d), vec3( w, -h, -d), colorOuter, vec3(1, 0, 0));
    addQuadWithShininess(vec3(-w,  h,  d), vec3(-w,  h, -d), vec3( w,  h, -d), vec3( w,  h,  d), colorOuter, vec3(0, 1, 0));
    addQuadWithShininess(vec3(-w, -h,  d), vec3( w, -h,  d), vec3( w, -h, -d), vec3(-w, -h, -d), colorOuter, vec3(0, -1, 0));
}

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
    
    const nBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(normals), gl.STATIC_DRAW);
    const normalLoc = gl.getAttribLocation(program, "aNormal");
    gl.vertexAttribPointer(normalLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(normalLoc);
    
    const sBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(shininessValues), gl.STATIC_DRAW);
    const shininessLoc = gl.getAttribLocation(program, "aShininess");
    gl.vertexAttribPointer(shininessLoc, 1, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(shininessLoc);
    
    const tBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(texCoords), gl.STATIC_DRAW);
    const texCoordLoc = gl.getAttribLocation(program, "aTexCoord");
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(texCoordLoc);
}

// Render loop
function render() {
    const get = id => document.getElementById(id);
    const bgColor = get('bg-color').value;
    
    // Ambil nilai translasi monitor
    let posX = +get('position-x').value;
    let posY = +get('position-y').value; 
    let posZ = +get('position-z').value;
    
    // Nilai rotasi dan skala monitor sekarang diambil dari nilai default saat slider di-disable
    // atau nilai terakhir sebelum di-disable. Kita tidak perlu membacanya lagi di sini.
    // Jika Anda ingin *memaksa* nilai tertentu, set di sini:
    let rotX = 0, rotY = 0, rotZ = 0; // Nilai default dari HTML
    
    
    if (isAnimating) {
        animationTime += 0.016;
         // Animasi Spin, Bounce, Pulse sekarang tidak akan mempengaruhi monitor
         // karena rotY, posY, scaleValue tidak lagi dibaca dari slider untuk monitor
        if (animationPreset === 'tilt') {
            const t = 12 * Math.sin(animationTime * 2.0);
            tiltAngle = t;
            get('tilt-angle').value = tiltAngle.toFixed(0);
            get('tilt-angle-value').textContent = tiltAngle.toFixed(0);
        } else if (animationPreset === 'slide_table') { // --- ANIMASI GESER MEJA ---
            tablePosX = 1.5 * Math.sin(animationTime * 2.0);
            const tableSlider = get('table-pos-x');
            const tableSpan = get('table-pos-x-value');
            if (tableSlider && tableSpan) {
                tableSlider.value = tablePosX.toFixed(2);
                tableSpan.textContent = tablePosX.toFixed(2);
            }
        } else if (animationPreset === 'slide_mouse') {
            // Animasi mouse di atas meja (relatif terhadap meja)
            mousePosX = 0.5 + 0.3 * Math.sin(animationTime * 1.5);
            mousePosZ = 0.4 + 0.2 * Math.cos(animationTime * 2.0);
            
            // Update UI Slider-nya juga
            const mouseSliderX = get('mouse-pos-x');
            const mouseSpanX = get('mouse-pos-x-value');
            const mouseSliderZ = get('mouse-pos-z');
            const mouseSpanZ = get('mouse-pos-z-value');
            if (mouseSliderX && mouseSpanX) {
                mouseSliderX.value = mousePosX.toFixed(2);
                mouseSpanX.textContent = mousePosX.toFixed(2);
            }
            if (mouseSliderZ && mouseSpanZ) {
                mouseSliderZ.value = mousePosZ.toFixed(2);
                mouseSpanZ.textContent = mousePosZ.toFixed(2);
            }
        }
    }
    
    const [r, g, b] = hexToRgb(bgColor);
    gl.clearColor(r, g, b, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    updateProjectionMatrix();
    
    // --- PENERAPAN HIERARKI MATRIKS ---
    
    // 1. Matriks Kamera (View)
    let eye = vec3(eyeX, eyeY, eyeZ);
    let at = vec3(atX, atY, atZ);
    let up = vec3(upX, upY, upZ);
    let mvm = lookAt(eye, at, up);
    
    // 2. Matriks Meja (Induk dari Monitor)
    // Baca skala meja dari slider
    const tableScale = parseFloat(get('table-scale')?.value) || 1.0;
    // Pivot untuk skala meja: gunakan permukaan meja (table surface Y) sehingga monitor/mouse tetap di atas meja
    const tableSurfaceY = -0.29; // sama dengan createTable() asumsi
    const tablePivotX = 0, tablePivotY = tableSurfaceY, tablePivotZ = 0;

    let mvmTable = mult(mvm, translate(tablePosX, 0, 0)); 
    // Apply anchored scaling for table (translate to pivot -> scale -> translate back)
    mvmTable = mult(mvmTable, translate(tablePivotX, tablePivotY, tablePivotZ));
    mvmTable = mult(mvmTable, scale(tableScale, tableScale, tableScale));
    mvmTable = mult(mvmTable, translate(-tablePivotX, -tablePivotY, -tablePivotZ));
    
    // 3. Matriks Monitor Base (Anak dari Meja)
    let mvmBaseMonitor = mvmTable;
    mvmBaseMonitor = mult(mvmBaseMonitor, translate(posX, posY, posZ));

    // Baca nilai skala dari slider setiap frame (dynamic)
    const scaleValue = parseFloat(get('scale').value) || 1.0;

    // Terapkan skala dengan anchor di kaki monitor (scale pivot):
    // translate(pivot) -> scale -> translate(-pivot)
    mvmBaseMonitor = mult(mvmBaseMonitor, translate(scalePivotX, scalePivotY, scalePivotZ));
    mvmBaseMonitor = mult(mvmBaseMonitor, scale(scaleValue, scaleValue, scaleValue));
    mvmBaseMonitor = mult(mvmBaseMonitor, translate(-scalePivotX, -scalePivotY, -scalePivotZ));

    // Setelah skala diaplikasikan, terapkan rotasi (jika diperlukan)
    mvmBaseMonitor = mult(mvmBaseMonitor, rotate(rotZ, vec3(0, 0, 1)));
    mvmBaseMonitor = mult(mvmBaseMonitor, rotate(rotY, vec3(0, 1, 0)));
    mvmBaseMonitor = mult(mvmBaseMonitor, rotate(rotX, vec3(1, 0, 0)));

    // 4. Matriks Screen (Anak dari Monitor Base)
    let mvmScreen = mvmBaseMonitor;
    mvmScreen = mult(mvmScreen, translate(screenPivotX, screenPivotY, screenPivotZ));
    mvmScreen = mult(mvmScreen, rotate(tiltAngle, vec3(1, 0, 0))); // Tilt masih bisa
    mvmScreen = mult(mvmScreen, translate(-screenPivotX, -screenPivotY, -screenPivotZ));

    // --- END HIERARKI ---

    
    // Set uniform lighting & texturing (berlaku untuk semua objek)
    gl.uniform1i(lightingUniforms.enableLighting, enableLighting);
    gl.uniform3fv(lightingUniforms.lightPosition, flatten(lightPosition));
    gl.uniform3fv(lightingUniforms.lightColor, flatten(lightColor));
    gl.uniform3fv(lightingUniforms.ambientLight, flatten(ambientLight));
    gl.uniform3fv(lightingUniforms.eyePosition, flatten(vec3(eyeX, eyeY, eyeZ)));
    gl.uniform1f(lightingUniforms.ambientStrength, ambientStrength);
    gl.uniform1f(lightingUniforms.diffuseStrength, diffuseStrength);
    gl.uniform1f(lightingUniforms.specularStrength, specularStrength);
    
    gl.uniform1i(lightingUniforms.useTextures, useTextures);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, checkerboardTexture); // SUDAH DIPERBAIKI
    gl.uniform1i(lightingUniforms.checkerboardTexture, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, wallpaperTexture);
    gl.uniform1i(lightingUniforms.wallpaperTexture, 1);
    
    const wireframe = get('wireframe-mode').checked;
    let normalMatrix; 

    // --- DRAWING PASSES SESUAI HIERARKI ---
    
    // PASS 1: Gambar Meja (menggunakan mvmTable)
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(mvmTable));
    normalMatrix = mat3();
    let invTable = inverse(mvmTable);
    let trsTable = transpose(invTable);
    normalMatrix = mat3(
        trsTable[0][0], trsTable[0][1], trsTable[0][2],
        trsTable[1][0], trsTable[1][1], trsTable[1][2],
        trsTable[2][0], trsTable[2][1], trsTable[2][2]
    );
    gl.uniformMatrix3fv(lightingUniforms.normalMatrix, false, flatten(normalMatrix));
    
    const tableIndexStart = monitorIndexCount;
    if (tableIndexCount > 0) {
        if (wireframe) {
            for (let i = tableIndexStart; i < (monitorIndexCount + tableIndexCount); i += 3) {
                gl.drawElements(gl.LINE_LOOP, 3, gl.UNSIGNED_SHORT, i * 2);
            }
        } else {
            gl.drawElements(gl.TRIANGLES, tableIndexCount, gl.UNSIGNED_SHORT, tableIndexStart * 2);
        }
    }


    // PASS 1.5: GAMBAR MOUSE (ANAK DARI MEJA)
    let mvmMouse = mvmTable; // Mulai dari matriks meja

    // Permukaan atas meja (dari createTable): Y = -0.29
    const tableSurfaceY_local = tableSurfaceY; 

    // Pindahkan mouse ke posisinya di atas meja (createMouse membuat alas mouse di Y=0)
    mvmMouse = mult(mvmMouse, translate(mousePosX, tableSurfaceY_local, mousePosZ));

    // Baca skala mouse dari slider dan aplikasikan anchored scaling di basis mouse (Y=0 lokal)
    const mouseScale = parseFloat(get('mouse-scale')?.value) || 1.0;
    // Karena kita sudah mentranslate mouse ke posisinya, scaling di origin lokal akan meng-anchorkannya pada alas
    mvmMouse = mult(mvmMouse, scale(mouseScale, mouseScale, mouseScale));
    mvmMouse = mult(mvmMouse, rotate(180, vec3(0, 1, 0)));
    mvmMouse = mult(mvmMouse, rotate(15, vec3(0, 1, 0)));

    // Update mouse animation state (left & right buttons)
    const dt = 0.016;
    let leftPressOffset = 0.0;
    let rightPressOffset = 0.0;
    if (mouseLeftClickAnimating) {
        mouseLeftClickTime += dt;
        const t = Math.min(mouseLeftClickTime / mouseClickDuration, 1.0);
        leftPressOffset = mouseClickDepth * Math.sin(Math.PI * t);
        if (mouseLeftClickTime >= mouseClickDuration) {
            mouseLeftClickAnimating = false;
            mouseLeftClickTime = 0;
            leftPressOffset = 0.0;
        }
    }
    if (mouseRightClickAnimating) {
        mouseRightClickTime += dt;
        const t = Math.min(mouseRightClickTime / mouseClickDuration, 1.0);
        rightPressOffset = mouseClickDepth * Math.sin(Math.PI * t);
        if (mouseRightClickTime >= mouseClickDuration) {
            mouseRightClickAnimating = false;
            mouseRightClickTime = 0;
            rightPressOffset = 0.0;
        }
    }

    if (mouseScrollActive) {
        // rotate wheel continuously
        mouseWheelAngle = (mouseWheelAngle + 360.0 * dt * 1.5) % 360.0;
    }

    const mouseIndexStart = monitorIndexCount + tableIndexCount;

    // Draw mouse parts separately so we can animate palm (press) and wheel (spin)
    // 1) Base
    if (mouseBaseIndexCount > 0) {
        gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(mvmMouse));
        let invM = inverse(mvmMouse);
        let trsM = transpose(invM);
        normalMatrix = mat3(
            trsM[0][0], trsM[0][1], trsM[0][2],
            trsM[1][0], trsM[1][1], trsM[1][2],
            trsM[2][0], trsM[2][1], trsM[2][2]
        );
        gl.uniformMatrix3fv(lightingUniforms.normalMatrix, false, flatten(normalMatrix));
        if (wireframe) {
            for (let i = mouseBaseIndexStart; i < mouseBaseIndexStart + mouseBaseIndexCount; i += 3) {
                gl.drawElements(gl.LINE_LOOP, 3, gl.UNSIGNED_SHORT, i * 2);
            }
        } else {
            gl.drawElements(gl.TRIANGLES, mouseBaseIndexCount, gl.UNSIGNED_SHORT, mouseBaseIndexStart * 2);
        }
    }

    // 2) Body
    if (mouseBodyIndexCount > 0) {
        gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(mvmMouse));
        let invM = inverse(mvmMouse);
        let trsM = transpose(invM);
        normalMatrix = mat3(
            trsM[0][0], trsM[0][1], trsM[0][2],
            trsM[1][0], trsM[1][1], trsM[1][2],
            trsM[2][0], trsM[2][1], trsM[2][2]
        );
        gl.uniformMatrix3fv(lightingUniforms.normalMatrix, false, flatten(normalMatrix));
        if (wireframe) {
            for (let i = mouseBodyIndexStart; i < mouseBodyIndexStart + mouseBodyIndexCount; i += 3) {
                gl.drawElements(gl.LINE_LOOP, 3, gl.UNSIGNED_SHORT, i * 2);
            }
        } else {
            gl.drawElements(gl.TRIANGLES, mouseBodyIndexCount, gl.UNSIGNED_SHORT, mouseBodyIndexStart * 2);
        }
    }

    // 3) Palm (rear/top of the mouse)
    if (mousePalmIndexCount > 0) {
        gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(mvmMouse));
        let invP = inverse(mvmMouse);
        let trsP = transpose(invP);
        normalMatrix = mat3(
            trsP[0][0], trsP[0][1], trsP[0][2],
            trsP[1][0], trsP[1][1], trsP[1][2],
            trsP[2][0], trsP[2][1], trsP[2][2]
        );
        gl.uniformMatrix3fv(lightingUniforms.normalMatrix, false, flatten(normalMatrix));
        if (wireframe) {
            for (let i = mousePalmIndexStart; i < mousePalmIndexStart + mousePalmIndexCount; i += 3) {
                gl.drawElements(gl.LINE_LOOP, 3, gl.UNSIGNED_SHORT, i * 2);
            }
        } else {
            gl.drawElements(gl.TRIANGLES, mousePalmIndexCount, gl.UNSIGNED_SHORT, mousePalmIndexStart * 2);
        }
    }

    // 3) Left button (animated press)
    if (mouseLeftIndexCount > 0) {
        let mvmLeft = mvmMouse;
        mvmLeft = mult(mvmLeft, translate(mouseLeftPivot[0], mouseLeftPivot[1], mouseLeftPivot[2]));
        mvmLeft = mult(mvmLeft, translate(0, -leftPressOffset, 0));
        mvmLeft = mult(mvmLeft, translate(-mouseLeftPivot[0], -mouseLeftPivot[1], -mouseLeftPivot[2]));

        gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(mvmLeft));
        let invL = inverse(mvmLeft);
        let trsL = transpose(invL);
        normalMatrix = mat3(
            trsL[0][0], trsL[0][1], trsL[0][2],
            trsL[1][0], trsL[1][1], trsL[1][2],
            trsL[2][0], trsL[2][1], trsL[2][2]
        );
        gl.uniformMatrix3fv(lightingUniforms.normalMatrix, false, flatten(normalMatrix));
        if (wireframe) {
            for (let i = mouseLeftIndexStart; i < mouseLeftIndexStart + mouseLeftIndexCount; i += 3) {
                gl.drawElements(gl.LINE_LOOP, 3, gl.UNSIGNED_SHORT, i * 2);
            }
        } else {
            gl.drawElements(gl.TRIANGLES, mouseLeftIndexCount, gl.UNSIGNED_SHORT, mouseLeftIndexStart * 2);
        }
    }

    // 4) Right button (animated press)
    if (mouseRightIndexCount > 0) {
        let mvmRight = mvmMouse;
        mvmRight = mult(mvmRight, translate(mouseRightPivot[0], mouseRightPivot[1], mouseRightPivot[2]));
        mvmRight = mult(mvmRight, translate(0, -rightPressOffset, 0));
        mvmRight = mult(mvmRight, translate(-mouseRightPivot[0], -mouseRightPivot[1], -mouseRightPivot[2]));

        gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(mvmRight));
        let invR = inverse(mvmRight);
        let trsR = transpose(invR);
        normalMatrix = mat3(
            trsR[0][0], trsR[0][1], trsR[0][2],
            trsR[1][0], trsR[1][1], trsR[1][2],
            trsR[2][0], trsR[2][1], trsR[2][2]
        );
        gl.uniformMatrix3fv(lightingUniforms.normalMatrix, false, flatten(normalMatrix));
        if (wireframe) {
            for (let i = mouseRightIndexStart; i < mouseRightIndexStart + mouseRightIndexCount; i += 3) {
                gl.drawElements(gl.LINE_LOOP, 3, gl.UNSIGNED_SHORT, i * 2);
            }
        } else {
            gl.drawElements(gl.TRIANGLES, mouseRightIndexCount, gl.UNSIGNED_SHORT, mouseRightIndexStart * 2);
        }
    }

    // 4) Wheel (animated spin)
    if (mouseWheelIndexCount > 0) {
        let mvmWheel = mvmMouse;
        mvmWheel = mult(mvmWheel, translate(mouseWheelPivot[0], mouseWheelPivot[1], mouseWheelPivot[2]));
        mvmWheel = mult(mvmWheel, rotate(mouseWheelAngle, vec3(1, 0, 0)));
        mvmWheel = mult(mvmWheel, translate(-mouseWheelPivot[0], -mouseWheelPivot[1], -mouseWheelPivot[2]));

        gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(mvmWheel));
        let invW = inverse(mvmWheel);
        let trsW = transpose(invW);
        normalMatrix = mat3(
            trsW[0][0], trsW[0][1], trsW[0][2],
            trsW[1][0], trsW[1][1], trsW[1][2],
            trsW[2][0], trsW[2][1], trsW[2][2]
        );
        gl.uniformMatrix3fv(lightingUniforms.normalMatrix, false, flatten(normalMatrix));
        if (wireframe) {
            for (let i = mouseWheelIndexStart; i < mouseWheelIndexStart + mouseWheelIndexCount; i += 3) {
                gl.drawElements(gl.LINE_LOOP, 3, gl.UNSIGNED_SHORT, i * 2);
            }
        } else {
            gl.drawElements(gl.TRIANGLES, mouseWheelIndexCount, gl.UNSIGNED_SHORT, mouseWheelIndexStart * 2);
        }
    }


    // PASS 2: Gambar Screen (menggunakan mvmScreen)
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(mvmScreen));
    let invScr = inverse(mvmScreen);
    let trsScr = transpose(invScr);
    normalMatrix = mat3(
        trsScr[0][0], trsScr[0][1], trsScr[0][2],
        trsScr[1][0], trsScr[1][1], trsScr[1][2],
        trsScr[2][0], trsScr[2][1], trsScr[2][2]
    );
    gl.uniformMatrix3fv(lightingUniforms.normalMatrix, false, flatten(normalMatrix));
    
    if (screenIndexCount > 0) {
        if (wireframe) {
            for (let i = 0; i < screenIndexCount; i += 3) {
                gl.drawElements(gl.LINE_LOOP, 3, gl.UNSIGNED_SHORT, i * 2);
            }
        } else {
            gl.drawElements(gl.TRIANGLES, screenIndexCount, gl.UNSIGNED_SHORT, 0);
        }
    }

    // PASS 3: Gambar Monitor Stand/Base (menggunakan mvmBaseMonitor)
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(mvmBaseMonitor));
    let invBase = inverse(mvmBaseMonitor);
    let trsBase = transpose(invBase);
    normalMatrix = mat3(
        trsBase[0][0], trsBase[0][1], trsBase[0][2],
        trsBase[1][0], trsBase[1][1], trsBase[1][2],
        trsBase[2][0], trsBase[2][1], trsBase[2][2]
    );
    gl.uniformMatrix3fv(lightingUniforms.normalMatrix, false, flatten(normalMatrix));
    
    const restIndexStart = screenIndexCount;
    const restIndexCount = monitorIndexCount - screenIndexCount; // Hanya index stand
    if (restIndexCount > 0) {
        if (wireframe) {
            for (let i = restIndexStart; i < monitorIndexCount; i += 3) {
                gl.drawElements(gl.LINE_LOOP, 3, gl.UNSIGNED_SHORT, i * 2);
            }
        } else {
            gl.drawElements(gl.TRIANGLES, restIndexCount, gl.UNSIGNED_SHORT, restIndexStart * 2);
        }
    }
    
    // Pass 3.5 (kabel terpisah) Dihapus
    
    requestAnimationFrame(render);
}

function updateProjectionUI() {
    const orthoSettings = document.querySelectorAll('#ortho-left, #ortho-right, #ortho-bottom, #ortho-top').forEach(el => {
        if (el && el.closest('.control-row')) {
            el.closest('.control-row').style.display = projectionMode === 'orthogonal' ? 'flex' : 'none';
        }
    });
    
    const h4Elements = document.querySelectorAll('h4');
    h4Elements.forEach(h4 => {
        if (h4.textContent.includes('Orthogonal')) {
            h4.style.display = projectionMode === 'orthogonal' ? 'block' : 'none';
        }
    });
}

function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function updateProjectionMatrix() {
    const aspect = canvas.width / canvas.height;
    
    if (projectionMode === 'perspective') {
        projectionMatrix = perspective(fov, aspect, nearPlane, farPlane);
    } else {
        projectionMatrix = ortho(orthoLeft, orthoRight, orthoBottom, orthoTop, nearPlane, farPlane);
    }
    
    gl.uniformMatrix4fv(projectionMatrixLoc, false, flatten(projectionMatrix));
}

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

function updateCameraFromSpherical() {
    eyeX = cameraRadius * Math.cos(cameraPhi) * Math.cos(cameraTheta);
    eyeY = cameraRadius * Math.sin(cameraPhi);
    eyeZ = cameraRadius * Math.cos(cameraPhi) * Math.sin(cameraTheta);
    
    const eyeXSlider = document.getElementById('eye-x');
    const eyeYSlider = document.getElementById('eye-y');
    const eyeZSlider = document.getElementById('eye-z');
    const eyeXSpan = document.getElementById('eye-x-value');
    const eyeYSpan = document.getElementById('eye-y-value');
    const eyeZSpan = document.getElementById('eye-z-value');
    
    if (eyeXSlider && eyeXSpan) {
        eyeXSlider.value = eyeX;
        eyeXSpan.textContent = eyeX.toFixed(1);
    }
    if (eyeYSlider && eyeYSpan) {
        eyeYSlider.value = eyeY;
        eyeYSpan.textContent = eyeY.toFixed(1);
    }
    if (eyeZSlider && eyeZSpan) {
        eyeZSlider.value = eyeZ;
        eyeZSpan.textContent = eyeZ.toFixed(1);
    }
}

function setupEventListeners() {
    canvas.addEventListener('mousedown', (e) => {
        mouseDown = true;
        // If Shift is held when pressing mouse, enable panning mode
        mousePan = e.shiftKey;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    });
    
    canvas.addEventListener('mouseup', () => {
        mouseDown = false;
        mousePan = false;
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (!mouseDown) return;

        const deltaX = e.clientX - lastMouseX;
        const deltaY = e.clientY - lastMouseY;

        if (mousePan) {
            // Pan camera: translate both eye and at along camera right and up axes
            // Compute look (from eye to at) and camera basis
            const look = vec3(atX - eyeX, atY - eyeY, atZ - eyeZ);
            const lookN = normalize(look);
            const upVec = vec3(upX, upY, upZ);
            const right = normalize(cross(lookN, upVec));
            const upCam = normalize(cross(right, lookN));

            // pan scaling factor; scales with camera distance for nicer feel
            const panFactor = 0.002 * cameraRadius;
            const panX = -deltaX * panFactor;
            const panY = deltaY * panFactor;

            const tx = right[0] * panX + upCam[0] * panY;
            const ty = right[1] * panX + upCam[1] * panY;
            const tz = right[2] * panX + upCam[2] * panY;

            eyeX += tx; eyeY += ty; eyeZ += tz;
            atX += tx; atY += ty; atZ += tz;

            // Update spherical coordinates and UI sliders
            initializeSphericalCoords();
            updateCameraUI();
        } else {
            // Orbit rotation as before
            cameraTheta += deltaX * 0.01;
            cameraPhi += deltaY * 0.01;
            cameraPhi = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, cameraPhi));
            updateCameraFromSpherical();
        }

        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    });
    
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        cameraRadius += e.deltaY * 0.01;
        cameraRadius = Math.max(1, Math.min(10, cameraRadius));
        updateCameraFromSpherical();
    });

    const projModeSelect = document.getElementById('projection-mode');
    if (projModeSelect) {
        projModeSelect.addEventListener('change', (e) => {
            projectionMode = e.target.value;
            updateProjectionMatrix();
            updateProjectionUI();
        });
    }
    
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
    
    // Slider untuk Monitor (HANYA POSISI)
    const monitorPosSliders = ['position-x', 'position-y', 'position-z'];
    monitorPosSliders.forEach(id => {
        const slider = document.getElementById(id);
        const span = document.getElementById(id + '-value');
        if (slider && span) {
             slider.addEventListener('input', () => {
                const value = parseFloat(slider.value);
                span.textContent = value.toFixed(2);
                // Tidak perlu update variabel global rotasi/skala lagi
            });
        }
    });

    // Scale slider wiring (dynamic scale with anchor at foot)
    const scaleSlider = document.getElementById('scale');
    const scaleSpan = document.getElementById('scale-value');
    if (scaleSlider && scaleSpan) {
        scaleSlider.addEventListener('input', () => {
            const v = parseFloat(scaleSlider.value);
            scaleSpan.textContent = v.toFixed(2);
        });
        // initialize display value
        scaleSpan.textContent = parseFloat(scaleSlider.value).toFixed(2);
    }

    // --- EVENT LISTENER UNTUK SLIDER MEJA ---
    const tableSlider = document.getElementById('table-pos-x');
    const tableSpan = document.getElementById('table-pos-x-value');
    if (tableSlider && tableSpan) {
        tableSlider.addEventListener('input', () => {
            tablePosX = parseFloat(tableSlider.value); // Update var global
            tableSpan.textContent = tablePosX.toFixed(2);
        });
    }
    
    // --- EVENT LISTENER UNTUK MOUSE ---
    const mouseSliderX = document.getElementById('mouse-pos-x');
    const mouseSpanX = document.getElementById('mouse-pos-x-value');
    if (mouseSliderX && mouseSpanX) {
        mouseSliderX.addEventListener('input', () => {
            mousePosX = parseFloat(mouseSliderX.value); 
            mouseSpanX.textContent = mousePosX.toFixed(2);
        });
    }
    
    const mouseSliderZ = document.getElementById('mouse-pos-z');
    const mouseSpanZ = document.getElementById('mouse-pos-z-value');
    if (mouseSliderZ && mouseSpanZ) {
        mouseSliderZ.addEventListener('input', () => {
            mousePosZ = parseFloat(mouseSliderZ.value); 
            mouseSpanZ.textContent = mousePosZ.toFixed(2);
        });
    }
    
    // Table scale slider wiring
    const tableScaleSlider = document.getElementById('table-scale');
    const tableScaleSpan = document.getElementById('table-scale-value');
    if (tableScaleSlider && tableScaleSpan) {
        tableScaleSlider.addEventListener('input', () => {
            tableScaleSpan.textContent = parseFloat(tableScaleSlider.value).toFixed(2);
        });
        tableScaleSpan.textContent = parseFloat(tableScaleSlider.value).toFixed(2);
    }

    // Mouse scale slider wiring
    const mouseScaleSlider = document.getElementById('mouse-scale');
    const mouseScaleSpan = document.getElementById('mouse-scale-value');
    if (mouseScaleSlider && mouseScaleSpan) {
        mouseScaleSlider.addEventListener('input', () => {
            mouseScaleSpan.textContent = parseFloat(mouseScaleSlider.value).toFixed(2);
        });
        mouseScaleSpan.textContent = parseFloat(mouseScaleSlider.value).toFixed(2);
    }
    
    // Mouse click (left/right) and scroll buttons
    const mouseLeftBtn = document.getElementById('mouse-left-click-btn');
    const mouseRightBtn = document.getElementById('mouse-right-click-btn');
    const mouseScrollBtn = document.getElementById('mouse-scroll-btn');
    if (mouseLeftBtn) {
        mouseLeftBtn.addEventListener('click', () => {
            mouseLeftClickAnimating = true;
            mouseLeftClickTime = 0;
        });
    }
    if (mouseRightBtn) {
        mouseRightBtn.addEventListener('click', () => {
            mouseRightClickAnimating = true;
            mouseRightClickTime = 0;
        });
    }
    if (mouseScrollBtn) {
        mouseScrollBtn.addEventListener('click', () => {
            mouseScrollActive = !mouseScrollActive;
            mouseScrollBtn.textContent = mouseScrollActive ? 'Stop Scroll' : 'Toggle Scroll';
        });
    }
    // ----------------------------------------------


    // Tilt slider wiring
    const tiltSlider = document.getElementById('tilt-angle');
    const tiltSpan = document.getElementById('tilt-angle-value');
    if (tiltSlider && tiltSpan) {
        tiltSlider.addEventListener('input', () => {
            tiltAngle = parseFloat(tiltSlider.value);
            tiltSpan.textContent = tiltAngle.toFixed(0);
        });
    }

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

    const enableLightingCheckbox = document.getElementById('enable-lighting');
    if (enableLightingCheckbox) {
        enableLightingCheckbox.addEventListener('change', (e) => {
            enableLighting = e.target.checked;
        });
    }

    const useTexturesCheckbox = document.getElementById('use-textures');
    if (useTexturesCheckbox) {
        useTexturesCheckbox.addEventListener('change', (e) => {
            useTextures = e.target.checked;
        });
    }

    const ambientStrengthSlider = document.getElementById('ambient-strength');
    const ambientStrengthSpan = document.getElementById('ambient-strength-value');
    if (ambientStrengthSlider && ambientStrengthSpan) {
        ambientStrengthSlider.addEventListener('input', () => {
            ambientStrength = parseFloat(ambientStrengthSlider.value);
            ambientStrengthSpan.textContent = ambientStrength.toFixed(2);
        });
    }

    const diffuseStrengthSlider = document.getElementById('diffuse-strength');
    const diffuseStrengthSpan = document.getElementById('diffuse-strength-value');
    if (diffuseStrengthSlider && diffuseStrengthSpan) {
        diffuseStrengthSlider.addEventListener('input', () => {
            diffuseStrength = parseFloat(diffuseStrengthSlider.value);
            diffuseStrengthSpan.textContent = diffuseStrength.toFixed(2);
        });
    }

    const specularStrengthSlider = document.getElementById('specular-strength');
    const specularStrengthSpan = document.getElementById('specular-strength-value');
    if (specularStrengthSlider && specularStrengthSpan) {
        specularStrengthSlider.addEventListener('input', () => {
            specularStrength = parseFloat(specularStrengthSlider.value);
            specularStrengthSpan.textContent = specularStrength.toFixed(2);
        });
    }

    const lightColorInput = document.getElementById('light-color');
    if (lightColorInput) {
        lightColorInput.addEventListener('input', (e) => {
            const [r, g, b] = hexToRgb(e.target.value);
            lightColor = vec3(r, g, b);
        });
    }

    const ambientColorInput = document.getElementById('ambient-color');
    if (ambientColorInput) {
        ambientColorInput.addEventListener('input', (e) => {
            const [r, g, b] = hexToRgb(e.target.value);
            ambientLight = vec3(r, g, b);
        });
    }

    const lightPosControls = [
        { id: 'light-pos-x', index: 0 },
        { id: 'light-pos-y', index: 1 },
        { id: 'light-pos-z', index: 2 }
    ];

    lightPosControls.forEach(control => {
        const slider = document.getElementById(control.id);
        const span = document.getElementById(control.id + '-value');
        if (slider && span) {
            slider.addEventListener('input', () => {
                const value = parseFloat(slider.value);
                lightPosition[control.index] = value;
                span.textContent = value.toFixed(1);
            });
        }
    });

    updateLightingUI();
    setupResponsiveCanvas();
}

function updateLightingUI() {
}

function setCameraPreset(preset) {
    switch (preset) {
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
    updateCameraSliders();
}

function updateCameraSliders() {
    document.getElementById('eye-x').value = eyeX;
    document.getElementById('eye-y').value = eyeY;
    document.getElementById('eye-z').value = eyeZ;
    document.getElementById('eye-x-value').textContent = eyeX.toFixed(1);
    document.getElementById('eye-y-value').textContent = eyeY.toFixed(1);
    document.getElementById('eye-z-value').textContent = eyeZ.toFixed(1);

    document.getElementById('at-x').value = atX;
    document.getElementById('at-y').value = atY;
    document.getElementById('at-z').value = atZ;
    document.getElementById('at-x-value').textContent = atX.toFixed(1);
    document.getElementById('at-y-value').textContent = atY.toFixed(1);
    document.getElementById('at-z-value').textContent = atZ.toFixed(1);

    document.getElementById('up-x').value = upX;
    document.getElementById('up-y').value = upY;
    document.getElementById('up-z').value = upZ;
    document.getElementById('up-x-value').textContent = upX.toFixed(1);
    document.getElementById('up-y-value').textContent = upY.toFixed(1);
    document.getElementById('up-z-value').textContent = upZ.toFixed(1);
}

function setupResponsiveCanvas() {
    function resizeCanvas() {
        const canvasContainer = canvas.parentElement;
        const rect = canvasContainer.getBoundingClientRect();
        
        let size = Math.min(rect.width - 20, window.innerHeight * 0.7, 800);
        size = Math.max(size, 350);
        
        canvas.width = size;
        canvas.height = size;
        
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
        
        gl.viewport(0, 0, canvas.width, canvas.height);
        
        updateProjectionMatrix();
    }
    
    resizeCanvas();
    
    window.addEventListener('resize', resizeCanvas);
    
    window.addEventListener('orientationchange', function() {
        setTimeout(resizeCanvas, 100);
    });
}

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
        if (!this.prevBtn) return; // Guard clause if carousel doesn't exist
        
        this.prevBtn.addEventListener('click', () => this.previousImage());
        this.nextBtn.addEventListener('click', () => this.nextImage());
        
        this.indicators.forEach((indicator, index) => {
            indicator.addEventListener('click', () => this.goToImage(index));
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                this.previousImage();
            } else if (e.key === 'ArrowRight') {
                this.nextImage();
            }
        });
        
        this.addTouchSupport();
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
        this.images.forEach((img, index) => {
            img.classList.toggle('active', index === this.currentIndex);
        });
        
        this.indicators.forEach((indicator, index) => {
            indicator.classList.toggle('active', index === this.currentIndex);
        });
        
        if (this.photoCounter) {
            this.photoCounter.textContent = this.currentIndex + 1;
        }
    }
    
    addTouchSupport() {
        const container = document.querySelector('.carousel-container');
        if (!container) return;
        
        let startX = 0;
        let startY = 0;
        let threshold = 50;
        
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
            
            if (Math.abs(deltaX) > Math.abs(deltaY)) {
                if (Math.abs(deltaX) > threshold) {
                    if (deltaX > 0) {
                        this.nextImage();
                    } else {
                        this.previousImage();
                    }
                }
            }
            
            startX = 0;
            startY = 0;
        }, { passive: true });
    }
    
    startAutoPlay() {
        setInterval(() => {
            this.nextImage();
        }, 5000);
    }
}

// Panggil PhotoCarousel saat DOM siap
document.addEventListener('DOMContentLoaded', () => {
    new PhotoCarousel();
});
