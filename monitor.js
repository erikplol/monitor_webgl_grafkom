"use strict";

/**
 * ============================================================================
 * CONFIGURATION OBJECT
 * ============================================================================
 */
const CONFIG = {
    // Mouse interaction settings
    mouse: {
        clickDuration: 0.6, 
        clickDepth: 0.02,   
        defaultPosX: 0.5,   
        defaultPosY: 0,     
        defaultPosZ: 0.3    
    },
    // Camera default positioning
    camera: {
        defaultEyeX: 0,          
        defaultEyeY: 0,          
        defaultEyeZ: 3,         
        defaultAtX: 0,           
        defaultAtY: 0,           
        defaultAtZ: 0,           
        defaultUpX: 0,           
        defaultUpY: 1,          
        defaultUpZ: 0            
    },
    // Projection matrix parameters
    projection: {
        defaultFov: 50,          
        nearPlane: 0.1,          
        farPlane: 100,           
        orthoLeft: -2,           
        orthoRight: 2,           
        orthoBottom: -2,         
        orthoTop: 2              
    },
    // Phong lighting model parameters
    lighting: {
        defaultAmbientStrength: 0.3,   
        defaultDiffuseStrength: 1.0,   
        defaultSpecularStrength: 1.5   
    }
};

/**
 * ============================================================================
 * GLOBAL VARIABLES
 * ============================================================================
 */

// --- WebGL Core ---
let canvas, gl, program;
let modelViewMatrix, projectionMatrix, modelViewMatrixLoc, projectionMatrixLoc;

// --- Geometry Buffers ---
// All geometry is stored in shared arrays and rendered using indexed drawing
let vertices = [];           
let vertexColors = [];
let indices = [];
let normals = [];
let shininessValues = [];
let texCoords = [];

// --- Index Counts for Each Model Part ---
// These track how many indices belong to each object for proper rendering
let screenIndexCount = 0;    // Monitor screen (textured, tilts)
let monitorIndexCount = 0;   // Entire monitor (screen + stand)
let tableIndexCount = 0;     // Table/desk surface
let mouseIndexCount = 0;     // Entire mouse

// --- Hierarchical Transform Variables ---
// Table is the parent; monitor and mouse are children
let tablePosX = 0, tablePosY = 0, tablePosZ = 0;
let mousePosX = CONFIG.mouse.defaultPosX;
let mousePosY = CONFIG.mouse.defaultPosY;
let mousePosZ = CONFIG.mouse.defaultPosZ;

// --- Mouse Component Indices ---
// Mouse is built from multiple parts for independent animation
let mouseBaseIndexStart = 0, mouseBaseIndexCount = 0;      // Bottom shell
let mouseBodyIndexStart = 0, mouseBodyIndexCount = 0;      // Main body
let mousePalmIndexStart = 0, mousePalmIndexCount = 0;      // Palm rest area
let mouseLeftIndexStart = 0, mouseLeftIndexCount = 0;      // Left click button
let mouseGripIndexStart = 0, mouseGripIndexCount = 0;      // Side grip (unused)
let mouseRightIndexStart = 0, mouseRightIndexCount = 0;    // Right click button
let mouseWheelIndexStart = 0, mouseWheelIndexCount = 0;    // Scroll wheel

// --- Mouse Animation Pivots ---
// Pivot points for rotating/translating mouse parts
let mouseLeftPivot = vec3(0,0,0);     
let mouseRightPivot = vec3(0,0,0);     
let mouseWheelPivot = vec3(0,0,0);   

// --- Mouse Interaction State ---
let mouseLeftClickAnimating = false;  
let mouseLeftClickTime = 0;          
let mouseRightClickAnimating = false;  
let mouseRightClickTime = 0;           
let mouseScrollActive = false;         
let mouseWheelAngle = 0;              

// --- Monitor Transform Variables ---
let tiltAngle = 0;                                         
let screenPivotX = 0, screenPivotY = 0, screenPivotZ = 0;   
let scalePivotX = 0, scalePivotY = 0, scalePivotZ = 0;     

// --- Animation System State ---
let isAnimating = false;         
let animationPreset = 'spin';   
let animationTime = 0;          

// --- Texture System ---
let wallpaperTexture;           
let useTextures = true;          

// --- Projection Mode ---
let projectionMode = 'perspective';  
let fov = CONFIG.projection.defaultFov;
let nearPlane = CONFIG.projection.nearPlane;
let farPlane = CONFIG.projection.farPlane;
let orthoLeft = CONFIG.projection.orthoLeft;
let orthoRight = CONFIG.projection.orthoRight;
let orthoBottom = CONFIG.projection.orthoBottom;
let orthoTop = CONFIG.projection.orthoTop;

// --- Camera Position (View Matrix) ---
let eyeX = CONFIG.camera.defaultEyeX;    
let eyeY = CONFIG.camera.defaultEyeY;
let eyeZ = CONFIG.camera.defaultEyeZ;
let atX = CONFIG.camera.defaultAtX;      
let atY = CONFIG.camera.defaultAtY;
let atZ = CONFIG.camera.defaultAtZ;
let upX = CONFIG.camera.defaultUpX;     
let upY = CONFIG.camera.defaultUpY;
let upZ = CONFIG.camera.defaultUpZ;

// --- Camera Interaction State ---
let mouseDown = false;           
let lastMouseX = 0, lastMouseY = 0; 
let mousePan = false;            
let cameraRadius = 3;            
let cameraTheta = 0;             
let cameraPhi = 0;               

/**
 * Initializes spherical camera coordinates from Cartesian eye position.
 * Used for spherical camera control (orbit around target).
 */
function initializeSphericalCoords() {
    cameraRadius = Math.sqrt(eyeX * eyeX + eyeY * eyeY + eyeZ * eyeZ);
    cameraTheta = Math.atan2(eyeZ, eyeX);
    cameraPhi = Math.asin(eyeY / cameraRadius);
}

// --- Phong Lighting Model Variables ---
let enableLighting = true;      
let lightPosition = vec3(-5.0, 5.0, 8.0);   
let lightColor = vec3(0.5, 0.5, 0.5);        
let ambientLight = vec3(0.3, 0.3, 0.3);     
let ambientStrength = CONFIG.lighting.defaultAmbientStrength;   
let diffuseStrength = CONFIG.lighting.defaultDiffuseStrength;  
let specularStrength = CONFIG.lighting.defaultSpecularStrength;  

let lightingUniforms = {};      

/**
 * ============================================================================
 * LEFT-CHILD RIGHT-SIBLING TREE STRUCTURE
 * ============================================================================
 * Implements hierarchical scene graph using LCRS (Left-Child Right-Sibling) representation.
 * Each node has:
 * - leftChild: First child node
 * - rightSibling: Next sibling node
 */

class SceneNode {
    constructor(name, renderFunc = null, transformFunc = null) {
        this.name = name;
        this.renderFunc = renderFunc;
        this.transformFunc = transformFunc;
        this.leftChild = null;
        this.rightSibling = null;
        this.transform = mat4();
        this.worldTransform = mat4();
    }

    addChild(childNode) {
        if (!this.leftChild) {
            this.leftChild = childNode;
        } else {
            let current = this.leftChild;
            while (current.rightSibling) current = current.rightSibling;
            current.rightSibling = childNode;
        }
        return this;
    }

    traverse(callback, parentTransform = mat4()) {
        // Compute transforms
        if (this.transformFunc) this.transform = this.transformFunc();
        this.worldTransform = mult(parentTransform, this.transform);
        
        // Process this node
        callback(this);
        
        // LCRS traversal: children then siblings
        if (this.leftChild) this.leftChild.traverse(callback, this.worldTransform);
        if (this.rightSibling) this.rightSibling.traverse(callback, parentTransform);
    }

    render(parentTransform = mat4()) {
        this.traverse(node => {
            if (node.renderFunc) node.renderFunc(node.worldTransform);
        }, parentTransform);
    }

    findNode(name) {
        if (this.name === name) return this;
        if (this.leftChild) {
            const found = this.leftChild.findNode(name);
            if (found) return found;
        }
        if (this.rightSibling) return this.rightSibling.findNode(name);
        return null;
    }
}

// Helper functions for common transform operations
const TransformHelpers = {
    positionScaleTransform(posX, posY, posZ, scale, pivotX = 0, pivotY = 0, pivotZ = 0) {
        let m = mat4();
        m = mult(m, translate(posX, posY, posZ));
        if (pivotX || pivotY || pivotZ) {
            m = mult(m, translate(-pivotX, -pivotY, -pivotZ));
            m = mult(m, this.scaleUniform(scale));
            m = mult(m, translate(pivotX, pivotY, pivotZ));
        } else {
            m = mult(m, this.scaleUniform(scale));
        }
        return m;
    },
    
    scaleUniform(s) {
        return scale(s, s, s);
    },
    
    rotateAroundPivot(angle, axis, pivotX, pivotY, pivotZ) {
        let m = mat4();
        m = mult(m, translate(pivotX, pivotY, pivotZ));
        m = mult(m, rotate(angle, axis));
        m = mult(m, translate(-pivotX, -pivotY, -pivotZ));
        return m;
    }
};

// Helper for rendering geometry
const RenderHelpers = {
    drawGeometry(worldTransform, indexCount, indexStart, wireframe) {
        RenderingSystem.setModelViewMatrix(worldTransform);
        RenderingSystem.drawElements(indexCount, indexStart, wireframe);
    },
    
    drawMultipleGeometry(worldTransform, geometryParts, wireframe) {
        RenderingSystem.setModelViewMatrix(worldTransform);
        geometryParts.forEach(part => {
            RenderingSystem.drawElements(part.count, part.start, wireframe);
        });
    }
};

/**
 * Global scene graph root
 */
let sceneGraph = null;

/**
 * Initialize the scene graph with LCRS structure
 */
function initializeSceneGraph() {
    const wireframeMode = () => get('wireframe-mode').checked;
    
    // Root node
    sceneGraph = new SceneNode('World', null, () => mat4());
    
    // === TABLE NODE ===
    const tableNode = new SceneNode('Table',
        (wt) => RenderingSystem.drawTable(wt, wireframeMode()),
        () => TransformHelpers.positionScaleTransform(
            parseFloat(get('table-pos-x').value),
            parseFloat(get('table-pos-y').value),
            parseFloat(get('table-pos-z').value),
            parseFloat(get('table-scale').value)
        )
    );
    
    // === MONITOR NODES ===
    const monitorNode = new SceneNode('Monitor', null, () => 
        TransformHelpers.positionScaleTransform(
            parseFloat(get('position-x').value),
            parseFloat(get('position-y').value),
            parseFloat(get('position-z').value),
            parseFloat(get('scale').value),
            scalePivotX, scalePivotY, scalePivotZ
        )
    );
    
    const monitorScreenNode = new SceneNode('MonitorScreen',
        (wt) => RenderHelpers.drawGeometry(wt, screenIndexCount, 0, wireframeMode()),
        () => TransformHelpers.rotateAroundPivot(
            parseFloat(get('tilt-angle').value),
            vec3(1, 0, 0),
            screenPivotX, screenPivotY, screenPivotZ
        )
    );
    
    const monitorBaseNode = new SceneNode('MonitorBase',
        (wt) => RenderHelpers.drawGeometry(wt, monitorIndexCount - screenIndexCount, screenIndexCount, wireframeMode()),
        () => mat4()
    );
    
    monitorNode.addChild(monitorScreenNode).addChild(monitorBaseNode);
    
    // === MOUSE NODES ===
    const mouseNode = new SceneNode('Mouse', null, () => {
        const mx = parseFloat(get('mouse-pos-x').value);
        const my = parseFloat(get('mouse-pos-y').value);
        const mz = parseFloat(get('mouse-pos-z').value);
        const ms = parseFloat(get('mouse-scale').value);
        
        let m = mat4();
        m = mult(m, translate(mx, my, mz));
        m = mult(m, rotate(180, vec3(0, 1, 0)));
        m = mult(m, rotate(15, vec3(0, 1, 0)));
        m = mult(m, TransformHelpers.scaleUniform(ms));
        return m;
    });
    
    const mouseBodyNode = new SceneNode('MouseBody',
        (wt) => RenderHelpers.drawMultipleGeometry(wt, [
            { count: mouseBaseIndexCount, start: mouseBaseIndexStart },
            { count: mouseBodyIndexCount, start: mouseBodyIndexStart },
            { count: mousePalmIndexCount, start: mousePalmIndexStart }
        ], wireframeMode()),
        () => mat4()
    );
    
    const mouseLeftButtonNode = new SceneNode('MouseLeftButton',
        (wt) => {
            let offset = 0;
            if (mouseLeftClickAnimating) {
                mouseLeftClickTime += 0.016;
                if (mouseLeftClickTime >= CONFIG.mouse.clickDuration) {
                    mouseLeftClickAnimating = false;
                    mouseLeftClickTime = 0;
                }
                offset = Math.sin((mouseLeftClickTime / CONFIG.mouse.clickDuration) * Math.PI) * CONFIG.mouse.clickDepth;
            }
            const btnTransform = mult(wt, translate(0, -offset, 0));
            RenderHelpers.drawGeometry(btnTransform, mouseLeftIndexCount, mouseLeftIndexStart, wireframeMode());
        },
        () => mat4()
    );
    
    const mouseRightButtonNode = new SceneNode('MouseRightButton',
        (wt) => {
            let offset = 0;
            if (mouseRightClickAnimating) {
                mouseRightClickTime += 0.016;
                if (mouseRightClickTime >= CONFIG.mouse.clickDuration) {
                    mouseRightClickAnimating = false;
                    mouseRightClickTime = 0;
                }
                offset = Math.sin((mouseRightClickTime / CONFIG.mouse.clickDuration) * Math.PI) * CONFIG.mouse.clickDepth;
            }
            const btnTransform = mult(wt, translate(0, -offset, 0));
            RenderHelpers.drawGeometry(btnTransform, mouseRightIndexCount, mouseRightIndexStart, wireframeMode());
        },
        () => mat4()
    );
    
    const mouseScrollWheelNode = new SceneNode('MouseScrollWheel',
        (wt) => {
            if (mouseScrollActive) mouseWheelAngle += 180 * 0.016;
            
            const wheelTransform = mult(wt, 
                TransformHelpers.rotateAroundPivot(
                    mouseWheelAngle, 
                    vec3(1, 0, 0),
                    mouseWheelPivot[0], mouseWheelPivot[1], mouseWheelPivot[2]
                )
            );
            RenderHelpers.drawGeometry(wheelTransform, mouseWheelIndexCount, mouseWheelIndexStart, wireframeMode());
        },
        () => mat4()
    );
    
    // Build mouse hierarchy
    mouseNode.addChild(mouseBodyNode)
             .addChild(mouseLeftButtonNode)
             .addChild(mouseRightButtonNode)
             .addChild(mouseScrollWheelNode);
    
    // Build scene hierarchy: World -> Table -> (Monitor, Mouse)
    tableNode.addChild(monitorNode).addChild(mouseNode);
    sceneGraph.addChild(tableNode);
    
    return sceneGraph;
}

/**
 * ============================================================================
 * TEXTURE LOADING SYSTEM
 * ============================================================================
 */

//Loads an image texture into WebGL.
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

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 * Helper functions to reduce code duplication and improve readability.
 */

function updateSlider(sliderId, value, decimals = 2) {
    const slider = document.getElementById(sliderId);
    const span = document.getElementById(`${sliderId}-value`);
    if (slider && span) {
        const formattedValue = value.toFixed(decimals);
        slider.value = formattedValue;
        span.textContent = formattedValue;
    }
}

function hexToRgb(hex) {
    const bigint = parseInt(hex.slice(1), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255].map(c => c / 255);
}

function get(id) {
    return document.getElementById(id);
}

/**
 * ============================================================================
 * INITIALIZATION SYSTEM
 * ============================================================================
 */

function init() {
    initializeWebGL();
    loadInitialValues();
    createGeometry();
    setupBuffers();
    loadTextures();
    setupUniforms();
    initializeSphericalCoords();
    initializeSceneGraph();  
    setupEventListeners();
    updateProjectionMatrix();
    updateProjectionUI();
    render();
}

function initializeWebGL() {
    canvas = get("gl-canvas");
    gl = canvas.getContext('webgl2');
    if (!gl) {
        alert("WebGL 2.0 isn't available");
        return;
    }
    gl.clearColor(1, 1, 1, 1);
    gl.enable(gl.DEPTH_TEST);
    program = initShaders(gl, "vertex-shader", "fragment-shader");
    gl.useProgram(program);
}

function loadInitialValues() {
    mousePosX = parseFloat(get('mouse-pos-x').value);
    mousePosZ = parseFloat(get('mouse-pos-z').value);
}

function createGeometry() {
    createMonitor();
    monitorIndexCount = indices.length;
    
    createTable();
    tableIndexCount = indices.length - monitorIndexCount;
    
    createMouse();
    mouseIndexCount = indices.length - monitorIndexCount - tableIndexCount;
}

function loadTextures() {
    wallpaperTexture = loadTexture(gl, 'wallpaper.jpg', true);
}

function setupUniforms() {
    modelViewMatrixLoc = gl.getUniformLocation(program, "modelViewMatrix");
    projectionMatrixLoc = gl.getUniformLocation(program, "projectionMatrix");
    
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
        wallpaperTexture: gl.getUniformLocation(program, "wallpaperTexture")
    };
}

/**
 * ============================================================================
 * 3D MODEL CREATION - TABLE
 * ============================================================================
 */
function createTable() {
    // === MATERIAL COLORS ===
    const darkWoodColor = vec4(0.3, 0.2, 0.15, 1.0);   
    const whitePanelColor = vec4(0.95, 0.95, 0.95, 1.0); 
    const bodyShininess = 3.0;  

    // === TABLE TOP DIMENSIONS ===
    const tableTopWidth = 2.0;
    const tableTopHeight = 0.05;
    const tableTopDepth = 1.0;
    const tableTopY = -0.29 - (tableTopHeight / 2); 
    
    // === SIDE PANEL (LEG) DIMENSIONS ===
    // Thick vertical panels on left and right sides
    const panelHeight = 0.7; 
    const panelY = tableTopY - (tableTopHeight / 2) - (panelHeight / 2); 
    const sidePanelThickness = 0.04; 
    const sidePanelDepth = 0.9;    
    const sidePanelXOffset = (tableTopWidth / 2) - (sidePanelThickness / 2) - 0.05; 

    // 1. Tabletop Surface (dark wood)
    createCubeWithShininess(tableTopWidth, tableTopHeight, tableTopDepth, darkWoodColor, 0, tableTopY, 0, bodyShininess);
    
    // 2. Left Side Panel/Leg (dark wood, facing sideways)
    createCubeWithShininess(sidePanelThickness, panelHeight, sidePanelDepth, darkWoodColor, -sidePanelXOffset, panelY, 0, bodyShininess); 
    
    // 3. Right Side Panel/Leg (dark wood, facing sideways)
    createCubeWithShininess(sidePanelThickness, panelHeight, sidePanelDepth, darkWoodColor, sidePanelXOffset, panelY, 0, bodyShininess);
    
    // === FRONT PANELS ===
    const frontPanelThickness = 0.02;
    const frontPanelZ = (-sidePanelDepth / 2) + 0.1 + (frontPanelThickness / 2); 
    
    // Calculate inner edges of side panels
    const leftInnerEdge = -sidePanelXOffset + (sidePanelThickness / 2);
    const rightInnerEdge = sidePanelXOffset - (sidePanelThickness / 2);
    const totalInnerWidth = rightInnerEdge - leftInnerEdge; 

    // 4. White Horizontal Panel (drawer/storage appearance)
    const whitePanelWidth = 1.2;
    const whitePanelHeight = panelHeight * 0.9;
    const whitePanelY = panelY - (panelHeight - whitePanelHeight) / 2; 
    const whitePanelCenterX = leftInnerEdge + (whitePanelWidth / 2);
    
    createCubeWithShininess(
        whitePanelWidth,      // Width (horizontal)
        whitePanelHeight,     // Height (short)
        frontPanelThickness,  // Depth (thin)
        whitePanelColor,
        whitePanelCenterX,
        whitePanelY,
        frontPanelZ,
        bodyShininess
    );
    
    // 5. Brown Vertical Divider Panel (fills remaining space)
    const brownPanelWidth = totalInnerWidth - whitePanelWidth; 
    const whitePanelRightEdge = whitePanelCenterX + (whitePanelWidth / 2);
    const brownPanelCenterX = whitePanelRightEdge + (brownPanelWidth / 2);
    
    createCubeWithShininess(
        brownPanelWidth,       // Width (calculated to fill space)
        panelHeight,           // Height (full, matches legs)
        frontPanelThickness,   // Depth (thin, matches white panel)
        darkWoodColor,         
        brownPanelCenterX,
        panelY,              
        frontPanelZ,
        bodyShininess
    );
}

/**
 * ============================================================================
 * 3D MODEL CREATION - COMPUTER MOUSE
 * ============================================================================
 * Creates a realistic wireless mouse model inspired by modern ergonomic designs.
 * Features smooth, curved body with tapered front, integrated left/right buttons,
 * and a center scroll wheel.
 */
function createMouse() {
    // === MATERIAL PROPERTIES ===
    const mouseBodyColor = vec4(0.15, 0.15, 0.15, 1.0);      // Dark gray body
    const mouseButtonColor = vec4(0.12, 0.12, 0.12, 1.0);    // Slightly darker buttons
    const wheelColor = vec4(0.08, 0.08, 0.08, 1.0);          // Even darker wheel
    const seamColor = vec4(0.05, 0.05, 0.05, 1.0);           // Dark seam line
    const mouseShininess = 15.0;                              // Matte plastic finish

    // === OVERALL MOUSE DIMENSIONS ===
    const mouseLength = 0.12;      // Front to back
    const mouseWidth = 0.07;       // Left to right
    const mouseMaxHeight = 0.035;  // Peak height at palm rest
    const baseY = 0;               // Ground level

    // === BOTTOM BASE (Foundation) ===
    // Wider, flatter base that sits on table
    const baseHeight = 0.006;
    const baseWidth = mouseWidth;
    const baseDepth = mouseLength * 0.95;
    
    let idxStart = indices.length;
    createCubeWithShininess(baseWidth, baseHeight, baseDepth, mouseBodyColor, 0, baseY + baseHeight/2, 0, mouseShininess);
    mouseBaseIndexStart = idxStart;
    mouseBaseIndexCount = indices.length - idxStart;

    // === MAIN BODY - LOWER SECTION ===
    // Slightly narrower than base, adds ergonomic curve
    const lowerBodyHeight = 0.012;
    const lowerBodyY = baseY + baseHeight;
    const lowerBodyWidth = mouseWidth * 0.92;
    const lowerBodyDepth = mouseLength * 0.90;
    
    idxStart = indices.length;
    createCubeWithShininess(lowerBodyWidth, lowerBodyHeight, lowerBodyDepth, mouseBodyColor, 0, lowerBodyY + lowerBodyHeight/2, -0.005, mouseShininess);
    mouseBodyIndexStart = idxStart;
    mouseBodyIndexCount = indices.length - idxStart;

    // === MAIN BODY - MIDDLE SECTION ===
    // Continues the curve upward, narrower still
    const midBodyHeight = 0.010;
    const midBodyY = lowerBodyY + lowerBodyHeight;
    const midBodyWidth = mouseWidth * 0.85;
    const midBodyDepth = mouseLength * 0.82;
    
    createCubeWithShininess(midBodyWidth, midBodyHeight, midBodyDepth, mouseBodyColor, 0, midBodyY + midBodyHeight/2, -0.010, mouseShininess);

    // === BUTTON AREA SETUP ===
    // Buttons cover the front portion, from mid-body up
    const buttonBaseY = midBodyY;
    const buttonHeight = 0.008;
    
    // === PALM REST AREA (Same height as buttons) ===
    // Back section where palm rests, now aligned with button height
    const palmHeight = buttonHeight;  // Match button height to avoid floating
    const palmY = buttonBaseY;         // Same base Y as buttons
    const palmWidth = mouseWidth * 0.75;
    const palmDepth = mouseLength * 0.40;  // Rear 40% of mouse
    const palmZOffset = -mouseLength * 0.25;  // Position toward back
    
    mousePalmIndexStart = indices.length;
    createCubeWithShininess(palmWidth, palmHeight, palmDepth, mouseBodyColor, 0, palmY + palmHeight/2, palmZOffset, mouseShininess);
    mousePalmIndexCount = indices.length - mousePalmIndexStart;
    const buttonTopY = buttonBaseY + buttonHeight;
    const buttonDepth = mouseLength * 0.55;  // Front 55% of mouse
    const buttonZOffset = mouseLength * 0.15;  // Position toward front
    
    // === CENTER SEAM (Visual divider between buttons) ===
    // Thin vertical strip down the center
    const seamWidth = 0.002;
    const seamDepth = buttonDepth * 0.7;  // Doesn't extend all the way
    const seamZOffset = buttonZOffset + buttonDepth * 0.05;
    
    createCubeWithShininess(seamWidth, buttonHeight, seamDepth, seamColor, 0, buttonBaseY + buttonHeight/2, seamZOffset, mouseShininess * 0.5);

    // === LEFT BUTTON ===
    // Left half of the button area
    const btnWidth = (mouseWidth * 0.85) / 2 - seamWidth/2 - 0.001;  // Half width minus seam
    const leftBtnX = -btnWidth/2 - seamWidth/2 - 0.001;
    
    mouseLeftIndexStart = indices.length;
    createCubeWithShininess(btnWidth, buttonHeight, buttonDepth, mouseButtonColor, leftBtnX, buttonBaseY + buttonHeight/2, buttonZOffset, mouseShininess);
    mouseLeftIndexCount = indices.length - mouseLeftIndexStart;
    mouseLeftPivot = vec3(leftBtnX, buttonBaseY + buttonHeight/2, buttonZOffset);

    // === RIGHT BUTTON ===
    // Right half of the button area
    const rightBtnX = btnWidth/2 + seamWidth/2 + 0.001;
    
    mouseRightIndexStart = indices.length;
    createCubeWithShininess(btnWidth, buttonHeight, buttonDepth, mouseButtonColor, rightBtnX, buttonBaseY + buttonHeight/2, buttonZOffset, mouseShininess);
    mouseRightIndexCount = indices.length - mouseRightIndexStart;
    mouseRightPivot = vec3(rightBtnX, buttonBaseY + buttonHeight/2, buttonZOffset);

    // === SCROLL WHEEL ===
    // Longer, thin wheel positioned at top center between buttons
    const wheelWidth = 0.008;
    const wheelHeight = 0.012;
    const wheelDepth = 0.025;  // Made longer for more realistic appearance
    const wheelY = buttonBaseY + buttonHeight + wheelHeight * 0.3;  // Slightly protruding above buttons
    const wheelZ = buttonZOffset + buttonDepth * 0.15;  // Front-center position
    
    mouseWheelIndexStart = indices.length;
    createCubeWithShininess(wheelWidth, wheelHeight, wheelDepth, wheelColor, 0, wheelY, wheelZ, mouseShininess * 0.7);
    mouseWheelIndexCount = indices.length - mouseWheelIndexStart;
    mouseWheelPivot = vec3(0, wheelY, wheelZ);

    // === FRONT TAPER (Nose of mouse) ===
    // Narrow, rounded front section for ergonomic shape
    const noseWidth = mouseWidth * 0.60;
    const noseHeight = 0.006;
    const noseDepth = mouseLength * 0.18;
    const noseY = lowerBodyY + lowerBodyHeight/2;
    const noseZ = mouseLength * 0.42;
    
    createCubeWithShininess(noseWidth, noseHeight, noseDepth, mouseBodyColor, 0, noseY, noseZ, mouseShininess);

    // === SIDE CONTOURS (Optional detail) ===
    // Subtle side panels for additional depth
    const sideWidth = mouseWidth * 0.82;
    const sideHeight = 0.005;
    const sideDepth = mouseLength * 0.50;
    const sideY = lowerBodyY + lowerBodyHeight/2;
    
    createCubeWithShininess(sideWidth, sideHeight, sideDepth, mouseBodyColor, 0, sideY, 0.01, mouseShininess);
}

/**
 * ============================================================================
 * 3D MODEL CREATION - MONITOR
 * ============================================================================
 */
function createMonitor() {
    // === MATERIAL COLORS ===
    const bezelColor = vec4(0.2, 0.2, 0.2, 1.0);    
    const panelColor = vec4(0.05, 0.05, 0.05, 1.0); 
    const standColor = vec4(0.18, 0.18, 0.18, 1.0); 
    const baseColor = vec4(0.18, 0.18, 0.18, 1.0); 

    // === MATERIAL SHININESS ===
    const screenShininess = 50.0;
    const bodyShininess = 5.0;   

    // === SCREEN DIMENSIONS ===
    const screenWidth = 0.7;
    const screenHeight = 0.42;
    const screenDepthFront = 0.02;
    const screenDepthBack = 0.05;
    const yOffset = 0.15; 

    // === BEZEL (FRAME) DIMENSIONS ===
    const sideThickness = 0.002;
    const frameDepth = screenDepthFront - 0.005;
    const frameCenterZ = (screenDepthFront - screenDepthBack) / 2 + 0.02;

    // LEFT BEZEL (Side frame)
    createCubeWithShininess(
        sideThickness, screenHeight - 0.005, 
        frameDepth, 
        bezelColor, 
        -screenWidth / 2 - sideThickness / 2, 
        yOffset, 
        frameCenterZ,
        bodyShininess);
    
    // RIGHT BEZEL (Side frame)
    createCubeWithShininess(
        sideThickness, 
        screenHeight - 0.005, 
        frameDepth, 
        bezelColor, 
        screenWidth / 2 + sideThickness / 2, 
        yOffset, 
        frameCenterZ,
        bodyShininess);
    
    // FRONT BEZEL (Outer frame face)
    createCubeFaceWithShininess(
        screenWidth, 
        screenHeight, 
        screenDepthFront, 
        bezelColor, 
        0, 
        yOffset, 
        0,
        bodyShininess);
    
    // DISPLAY PANEL (Textured screen surface)
    // This is where the wallpaper texture will be mapped
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
    
    // BOTTOM BEZEL (Frame bottom edge)
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

    // === MONITOR STAND ===
    const standHeight = 0.2;
    const standYPos = yOffset - (screenHeight / 2) - (standHeight / 2);

    // Mark all geometry up to this point as part of the tilt group (screen/frame)
    // This allows the screen to tilt independently while stand remains fixed
    screenIndexCount = indices.length;
    
    // Define tilt pivot point (at bottom of screen where it connects to stand)
    screenPivotX = 0;
    screenPivotY = standYPos + (standHeight / 2);
    screenPivotZ = 0;

    // === STAND AND BASE (NON-TILTABLE) ===
    // These components do not tilt with the screen
    
    // Vertical stand support (box with hole for cable management)
    createBoxWithHoleAndShininess(
        0.2,  // Width
        0.35, // Height
        0.03, // Depth
        0.05, // Hole size
        standColor, 
        standColor, 
        0,    // X position
        standYPos + (standHeight / 2) - 0.05, 
        -screenDepthBack * 1.7,  // Z position (behind screen)
        -20,  // Rotation X
        0,    // Rotation Y
        0,    // Rotation Z
        50,   // Segment count
        bodyShininess
    );

    // Base/foot (rectangular platform that sits on table)
    const baseYPos = standYPos - (standHeight / 2) - 0.015; // Approximately -0.275
    // Bottom of base: -0.275 - (0.03 / 2) = -0.29
    createCubeWithShininess(
        0.4,  // Width
        0.03, // Height of base
        0.3,  // Depth
        baseColor, 
        0,    // X position
        baseYPos, 
        -screenDepthBack * 0.5,  // Z position
        bodyShininess
    );

    // Define scale pivot point (anchor at bottom of base/foot for uniform scaling)
    // scalePivotY points to the bottommost position of the base (world/model space)
    scalePivotX = 0;
    scalePivotY = baseYPos - (0.03 / 2); // Bottom edge of base
    scalePivotZ = -screenDepthBack * 0.5; // Z center of base
}

/**
 * ============================================================================
 * GEOMETRY PRIMITIVE - CUBE WITH SHININESS
 * ============================================================================

 */
function createCubeWithShininess(width, height, depth, color, cx, cy, cz, shininess) {
    const w = width / 2, h = height / 2, d = depth / 2;
    
    // Face normals for Phong lighting (one normal per face)
    const faceNormals = [
        vec3(0, 0, 1),   // Front face (+Z)
        vec3(0, 0, -1),  // Back face (-Z)
        vec3(1, 0, 0),   // Right face (+X)
        vec3(-1, 0, 0),  // Left face (-X)
        vec3(0, 1, 0),   // Top face (+Y)
        vec3(0, -1, 0)   // Bottom face (-Y)
    ];
    
    // Vertex positions for each face (counter-clockwise winding)
    const faces = [
        [vec3(-w + cx, -h + cy, d + cz), vec3(w + cx, -h + cy, d + cz), vec3(w + cx, h + cy, d + cz), vec3(-w + cx, h + cy, d + cz)],  // Front
        [vec3(w + cx, -h + cy, -d + cz), vec3(-w + cx, -h + cy, -d + cz), vec3(-w + cx, h + cy, -d + cz), vec3(w + cx, h + cy, -d + cz)],  // Back
        [vec3(w + cx, -h + cy, d + cz), vec3(w + cx, -h + cy, -d + cz), vec3(w + cx, h + cy, -d + cz), vec3(w + cx, h + cy, d + cz)],  // Right
        [vec3(-w + cx, -h + cy, -d + cz), vec3(-w + cx, -h + cy, d + cz), vec3(-w + cx, h + cy, d + cz), vec3(-w + cx, h + cy, -d + cz)],  // Left
        [vec3(-w + cx, h + cy, d + cz), vec3(w + cx, h + cy, d + cz), vec3(w + cx, h + cy, -d + cz), vec3(-w + cx, h + cy, -d + cz)],  // Top
        [vec3(-w + cx, -h + cy, -d + cz), vec3(w + cx, -h + cy, -d + cz), vec3(w + cx, -h + cy, d + cz), vec3(-w + cx, -h + cy, d + cz)]   // Bottom
    ];
    
    // Texture coordinates for each face (standard 0-1 mapping)
    const faceTexCoords = [
        [vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)], // Front
        [vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)], // Back
        [vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)], // Right
        [vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)], // Left
        [vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)], // Top
        [vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)]  // Bottom
    ];
    
    // Build geometry for each face
    faces.forEach((faceVertices, faceIndex) => {
        const startIndex = vertices.length;
        
        // Add vertex attributes for each vertex in the face
        faceVertices.forEach((vertex, vertexIndex) => {
            vertices.push(vertex);
            vertexColors.push(color);
            normals.push(faceNormals[faceIndex]);  // Same normal for all vertices in face
            shininessValues.push(shininess);
            texCoords.push(faceTexCoords[faceIndex][vertexIndex]);
        });
        
        // Create two triangles for each quad face
        indices.push(startIndex, startIndex + 1, startIndex + 2);
        indices.push(startIndex, startIndex + 2, startIndex + 3);
    });
}

/**
 * Creates a single front-facing quad (for monitor screen display surface).
 * Optimized for texture mapping - only creates the visible front face.
 * 
 * Used specifically for the monitor's display panel where wallpaper texture is applied.
 */
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

/**
 * ============================================================================
 * ANIMATION SYSTEM
 * ============================================================================
 * Encapsulates all preset animation logic.
 * Eliminates code duplication by centralizing animation updates.
 */
const AnimationSystem = {
    /**
     * Animates the monitor screen tilt angle.
     * Creates a sinusoidal tilting motion.
     */
    updateTilt() {
        const t = 12 * Math.sin(animationTime * 2.0);
        tiltAngle = t;
        updateSlider('tilt-angle', tiltAngle, 0);
    },
    
    /**
     * Animates the table sliding along X-axis.
     */
    updateTableSlide() {
        tablePosX = 1.5 * Math.sin(animationTime * 2.0);
        updateSlider('table-pos-x', tablePosX, 2);
    },
    
    /**
     * Animates the monitor sliding in XZ plane.
     */
    updateMonitorSlide() {
        const posX = 0.5 * Math.sin(animationTime * 1.8);
        const posZ = 0.3 * Math.cos(animationTime * 1.5);
        updateSlider('position-x', posX, 2);
        updateSlider('position-z', posZ, 2);
        return { posX, posZ };
    },
    
    /**
     * Animates the mouse sliding on table surface.
     */
    updateMouseSlide() {
        mousePosX = 0.5 + 0.3 * Math.sin(animationTime * 1.5);
        mousePosZ = 0.4 + 0.2 * Math.cos(animationTime * 2.0);
        updateSlider('mouse-pos-x', mousePosX, 2);
        updateSlider('mouse-pos-z', mousePosZ, 2);
    },
    
    /**
     * Combines all animations simultaneously.
     */
    updateAllCombined() {
        this.updateTilt();
        
        tablePosX = 1.0 * Math.sin(animationTime * 1.2);
        updateSlider('table-pos-x', tablePosX, 2);
        
        const monitor = {
            posX: 0.4 * Math.sin(animationTime * 1.5),
            posZ: 0.2 * Math.cos(animationTime * 1.8)
        };
        updateSlider('position-x', monitor.posX, 2);
        updateSlider('position-z', monitor.posZ, 2);
        
        mousePosX = 0.5 + 0.25 * Math.sin(animationTime * 2.0);
        mousePosZ = 0.3 + 0.15 * Math.cos(animationTime * 2.5);
        updateSlider('mouse-pos-x', mousePosX, 2);
        updateSlider('mouse-pos-z', mousePosZ, 2);
        
        return monitor;
    },
    
    /**
     * Main animation update dispatcher.
     */
    update(preset) {
        animationTime += 0.016;
        
        switch(preset) {
            case 'tilt':
                this.updateTilt();
                return {};
            case 'slide_table':
                this.updateTableSlide();
                return {};
            case 'slide_monitor':
                return this.updateMonitorSlide();
            case 'slide_mouse':
                this.updateMouseSlide();
                return {};
            case 'all_combined':
                return this.updateAllCombined();
            default:
                return {};
        }
    }
};

/**
 * ============================================================================
 * RENDERING SYSTEM
 * ============================================================================
 */
const RenderingSystem = {
    /**
     * Sets up all Phong lighting uniforms for the current frame.
     * Sends lighting parameters to the fragment shader.
     */
    setupLightingUniforms() {
        gl.uniform1i(lightingUniforms.enableLighting, enableLighting);
        gl.uniform3fv(lightingUniforms.lightPosition, flatten(lightPosition));
        gl.uniform3fv(lightingUniforms.lightColor, flatten(lightColor));
        gl.uniform3fv(lightingUniforms.ambientLight, flatten(ambientLight));
        gl.uniform3fv(lightingUniforms.eyePosition, flatten(vec3(eyeX, eyeY, eyeZ)));
        gl.uniform1f(lightingUniforms.ambientStrength, ambientStrength);
        gl.uniform1f(lightingUniforms.diffuseStrength, diffuseStrength);
        gl.uniform1f(lightingUniforms.specularStrength, specularStrength);
    },
    
    /**
     * Sets up texture uniforms and binds textures to texture units.
     */
    setupTextureUniforms() {
        gl.uniform1i(lightingUniforms.useTextures, useTextures);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, wallpaperTexture);
        gl.uniform1i(lightingUniforms.wallpaperTexture, 0);
    },
    
    /**
     * Sets model-view matrix and computes/sets normal matrix for lighting.
     */
    setModelViewMatrix(matrix) {
        gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(matrix));
        const normalMatrix = MatrixBuilder.createNormalMatrix(matrix);
        gl.uniformMatrix3fv(lightingUniforms.normalMatrix, false, flatten(normalMatrix));
    },
    
    /**
     * Generic element drawing method supporting wireframe mode.
     */
    drawElements(indexCount, indexStart, wireframe) {
        if (indexCount > 0) {
            if (wireframe) {
                for (let i = indexStart; i < indexStart + indexCount; i += 3) {
                    gl.drawElements(gl.LINE_LOOP, 3, gl.UNSIGNED_SHORT, i * 2);
                }
            } else {
                gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, indexStart * 2);
            }
        }
    },
    
    /**
     * Draws the table/desk model.
     */
    drawTable(mvmTable, wireframe) {
        this.setModelViewMatrix(mvmTable);
        const tableIndexStart = monitorIndexCount;
        this.drawElements(tableIndexCount, tableIndexStart, wireframe);
    },
    
    /**
     * Draws the computer mouse with all interactive parts.
     * Handles button press and wheel rotation animations.
     */
    drawMouse(mvmMouse, wireframe, leftPressOffset, rightPressOffset) {
        // Draw mouse base (bottom shell)
        this.setModelViewMatrix(mvmMouse);
        this.drawElements(mouseBaseIndexCount, mouseBaseIndexStart, wireframe);
        
        // Draw mouse body (main shell)
        this.setModelViewMatrix(mvmMouse);
        this.drawElements(mouseBodyIndexCount, mouseBodyIndexStart, wireframe);
        
        // Draw mouse palm (rest area)
        this.setModelViewMatrix(mvmMouse);
        this.drawElements(mousePalmIndexCount, mousePalmIndexStart, wireframe);
        
        // Draw left button with click animation
        if (mouseLeftIndexCount > 0) {
            let mvmLeft = mvmMouse;
            mvmLeft = mult(mvmLeft, translate(mouseLeftPivot[0], mouseLeftPivot[1], mouseLeftPivot[2]));
            mvmLeft = mult(mvmLeft, translate(0, -leftPressOffset, 0));
            mvmLeft = mult(mvmLeft, translate(-mouseLeftPivot[0], -mouseLeftPivot[1], -mouseLeftPivot[2]));
            this.setModelViewMatrix(mvmLeft);
            this.drawElements(mouseLeftIndexCount, mouseLeftIndexStart, wireframe);
        }
        
        // Draw right button with click animation
        if (mouseRightIndexCount > 0) {
            let mvmRight = mvmMouse;
            mvmRight = mult(mvmRight, translate(mouseRightPivot[0], mouseRightPivot[1], mouseRightPivot[2]));
            mvmRight = mult(mvmRight, translate(0, -rightPressOffset, 0));
            mvmRight = mult(mvmRight, translate(-mouseRightPivot[0], -mouseRightPivot[1], -mouseRightPivot[2]));
            this.setModelViewMatrix(mvmRight);
            this.drawElements(mouseRightIndexCount, mouseRightIndexStart, wireframe);
        }
        
        // Draw mouse wheel with rotation
        if (mouseWheelIndexCount > 0) {
            let mvmWheel = mvmMouse;
            mvmWheel = mult(mvmWheel, translate(mouseWheelPivot[0], mouseWheelPivot[1], mouseWheelPivot[2]));
            mvmWheel = mult(mvmWheel, rotate(mouseWheelAngle, vec3(1, 0, 0)));
            mvmWheel = mult(mvmWheel, translate(-mouseWheelPivot[0], -mouseWheelPivot[1], -mouseWheelPivot[2]));
            this.setModelViewMatrix(mvmWheel);
            this.drawElements(mouseWheelIndexCount, mouseWheelIndexStart, wireframe);
        }
    },
    
    /**
     * Draws the monitor (screen and stand).
     */
    drawMonitor(mvmScreen, mvmBaseMonitor, wireframe) {
        // Draw screen (textured, can tilt)
        this.setModelViewMatrix(mvmScreen);
        this.drawElements(screenIndexCount, 0, wireframe);
        
        // Draw monitor stand/base
        this.setModelViewMatrix(mvmBaseMonitor);
        const restIndexStart = screenIndexCount;
        const restIndexCount = monitorIndexCount - screenIndexCount;
        this.drawElements(restIndexCount, restIndexStart, wireframe);
    }
};

/**
 * ============================================================================
 * MATRIX BUILDER SYSTEM
 * ============================================================================
 * Encapsulates hierarchical transformation matrix construction.
 */
const MatrixBuilder = {
    /**
     * Creates the view matrix from camera parameters.
     */
    createViewMatrix() {
        const eye = vec3(eyeX, eyeY, eyeZ);
        const at = vec3(atX, atY, atZ);
        const up = vec3(upX, upY, upZ);
        return lookAt(eye, at, up);
    },
    
    /**
     * Creates table transformation matrix (parent object).
     * Applies translation and scale with pivot at table surface.
     */
    createTableMatrix(viewMatrix) {
        const tableScale = parseFloat(get('table-scale')?.value) || 1.0;
        const tableSurfaceY = -0.29;
        const tablePivotX = 0, tablePivotY = tableSurfaceY, tablePivotZ = 0;

        let matrix = mult(viewMatrix, translate(tablePosX, tablePosY, tablePosZ));
        matrix = mult(matrix, translate(tablePivotX, tablePivotY, tablePivotZ));
        matrix = mult(matrix, scale(tableScale, tableScale, tableScale));
        matrix = mult(matrix, translate(-tablePivotX, -tablePivotY, -tablePivotZ));
        
        return matrix;
    },
    
    /**
     * Creates monitor base transformation matrix (child of table).
     * Applies translation, scale, and rotation. Scale pivot is at monitor foot.
     */
    createMonitorBaseMatrix(tableMatrix, posX, posY, posZ, rotX, rotY, rotZ) {
        let matrix = tableMatrix;
        matrix = mult(matrix, translate(posX, posY, posZ));

        const scaleValue = parseFloat(get('scale').value) || 1.0;

        // Apply scale with pivot at monitor base/foot
        matrix = mult(matrix, translate(scalePivotX, scalePivotY, scalePivotZ));
        matrix = mult(matrix, scale(scaleValue, scaleValue, scaleValue));
        matrix = mult(matrix, translate(-scalePivotX, -scalePivotY, -scalePivotZ));

        // Apply rotations (if any)
        matrix = mult(matrix, rotate(rotZ, vec3(0, 0, 1)));
        matrix = mult(matrix, rotate(rotY, vec3(0, 1, 0)));
        matrix = mult(matrix, rotate(rotX, vec3(1, 0, 0)));
        
        return matrix;
    },
    
    /**
     * Creates screen transformation matrix (child of monitor base).
     * Applies tilt rotation around hinge at bottom of screen.
     */
    createScreenMatrix(monitorBaseMatrix) {
        let matrix = monitorBaseMatrix;
        matrix = mult(matrix, translate(screenPivotX, screenPivotY, screenPivotZ));
        matrix = mult(matrix, rotate(tiltAngle, vec3(1, 0, 0)));
        matrix = mult(matrix, translate(-screenPivotX, -screenPivotY, -screenPivotZ));
        
        return matrix;
    },
    
    /**
     * Creates mouse transformation matrix (child of table).
     * Positions mouse on table surface with scale and orientation.
     */
    createMouseMatrix(tableMatrix) {
        const tableSurfaceY = -0.29;
        let matrix = tableMatrix;
        matrix = mult(matrix, translate(mousePosX, tableSurfaceY + mousePosY, mousePosZ));
        
        const mouseScale = parseFloat(get('mouse-scale')?.value) || 1.0;
        const mousePivotY = 0.01;
        matrix = mult(matrix, translate(0, mousePivotY, 0));
        matrix = mult(matrix, scale(mouseScale, mouseScale, mouseScale));
        matrix = mult(matrix, translate(0, -mousePivotY, 0));
        
        // Rotate mouse 180° + 15° for proper orientation
        matrix = mult(matrix, rotate(180, vec3(0, 1, 0)));
        matrix = mult(matrix, rotate(15, vec3(0, 1, 0)));
        
        return matrix;
    },
    
    /**
     * Creates normal matrix for proper lighting calculations.
     */
    createNormalMatrix(modelViewMatrix) {
        const inv = inverse(modelViewMatrix);
        const trs = transpose(inv);
        return mat3(
            trs[0][0], trs[0][1], trs[0][2],
            trs[1][0], trs[1][1], trs[1][2],
            trs[2][0], trs[2][1], trs[2][2]
        );
    }
};

/**
 * ============================================================================
 * RENDER LOOP
 * ============================================================================
 */
function render() {
    // Get background color from UI
    const bgColor = get('bg-color').value;
    
    // Get monitor position from sliders
    let posX = +get('position-x').value;
    let posY = +get('position-y').value; 
    let posZ = +get('position-z').value;
    
    // Update animations if active
    if (isAnimating) {
        const animatedValues = AnimationSystem.update(animationPreset);
        // Override position values if animation provides them
        if (animatedValues.posX !== undefined) posX = animatedValues.posX;
        if (animatedValues.posZ !== undefined) posZ = animatedValues.posZ;
    }
    
    // Clear buffers with background color
    const [r, g, b] = hexToRgb(bgColor);
    gl.clearColor(r, g, b, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    // Update projection matrix (perspective/orthogonal)
    updateProjectionMatrix();
    
    // Setup lighting and texture uniforms (Phong model)
    RenderingSystem.setupLightingUniforms();
    RenderingSystem.setupTextureUniforms();
    
    // =========================================================================
    // RENDER USING LEFT-CHILD RIGHT-SIBLING SCENE GRAPH
    // =========================================================================
    if (sceneGraph) {
        // Create view matrix as root transform
        const viewMatrix = MatrixBuilder.createViewMatrix();
        
        // Render entire scene graph hierarchy using LCRS traversal
        sceneGraph.render(viewMatrix);
    }
    
    // Request next frame
    requestAnimationFrame(render);
}

/**
 * ============================================================================
 * UI UPDATE FUNCTIONS
 * ============================================================================
 */

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

/**
 * Updates the projection matrix based on current mode.
 * Supports both perspective and orthogonal projections.
 */
function updateProjectionMatrix() {
    const aspect = canvas.width / canvas.height;
    
    if (projectionMode === 'perspective') {
        projectionMatrix = perspective(fov, aspect, nearPlane, farPlane);
    } else {
        projectionMatrix = ortho(orthoLeft, orthoRight, orthoBottom, orthoTop, nearPlane, farPlane);
    }
    
    gl.uniformMatrix4fv(projectionMatrixLoc, false, flatten(projectionMatrix));
}

/**
 * Updates camera slider UI to match current camera values.
 */
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

/**
 * Converts spherical coordinates to Cartesian camera position.
 * Updates eye position sliders to match spherical camera control.
 */
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
            tablePosX = parseFloat(tableSlider.value);
            tableSpan.textContent = tablePosX.toFixed(2);
        });
    }
    
    const tableSliderY = document.getElementById('table-pos-y');
    const tableSpanY = document.getElementById('table-pos-y-value');
    if (tableSliderY && tableSpanY) {
        tableSliderY.addEventListener('input', () => {
            tablePosY = parseFloat(tableSliderY.value);
            tableSpanY.textContent = tablePosY.toFixed(2);
        });
    }
    
    const tableSliderZ = document.getElementById('table-pos-z');
    const tableSpanZ = document.getElementById('table-pos-z-value');
    if (tableSliderZ && tableSpanZ) {
        tableSliderZ.addEventListener('input', () => {
            tablePosZ = parseFloat(tableSliderZ.value);
            tableSpanZ.textContent = tablePosZ.toFixed(2);
        });
    }
    
    const mouseSliderX = document.getElementById('mouse-pos-x');
    const mouseSpanX = document.getElementById('mouse-pos-x-value');
    if (mouseSliderX && mouseSpanX) {
        mouseSliderX.addEventListener('input', () => {
            mousePosX = parseFloat(mouseSliderX.value); 
            mouseSpanX.textContent = mousePosX.toFixed(2);
        });
    }
    
    const mouseSliderY = document.getElementById('mouse-pos-y');
    const mouseSpanY = document.getElementById('mouse-pos-y-value');
    if (mouseSliderY && mouseSpanY) {
        mouseSliderY.addEventListener('input', () => {
            mousePosY = parseFloat(mouseSliderY.value);
            mouseSpanY.textContent = mousePosY.toFixed(2);
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
        this.images.forEach((item, index) => {
            const isActive = index === this.currentIndex;
            item.classList.toggle('active', isActive);
            
            // Handle video playback
            if (item.tagName === 'VIDEO') {
                if (isActive) {
                    item.currentTime = 0; // Reset to start
                    item.play().catch(err => {
                        // Auto-play may be blocked, user can click play manually
                    });
                } else {
                    item.pause();
                }
            }
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

document.addEventListener('DOMContentLoaded', () => {
    new PhotoCarousel();
    init();
});
