"use strict";

var canvas;
var gl;

var axis = 0;
var xAxis = 0;
var yAxis =1;
var zAxis = 2;
var theta = [0, 0, 0];
var thetaLoc;
var flag = true;
var numElements = 36;
var ctm=[];
var MVMLoc;

// Animation state
var isAnimating = false;
var animationPreset = 'spin';
var animationTime = 0;

    var vertices = [
    // Monitor screen (box)
    vec3(-0.6,  0.4,  0.05), // 0 front top left
    vec3( 0.6,  0.4,  0.05), // 1 front top right
    vec3( 0.6, -0.2,  0.05), // 2 front bottom right
    vec3(-0.6, -0.2,  0.05), // 3 front bottom left
    vec3(-0.6,  0.4, -0.05), // 4 back top left
    vec3( 0.6,  0.4, -0.05), // 5 back top right
    vec3( 0.6, -0.2, -0.05), // 6 back bottom right
    vec3(-0.6, -0.2, -0.05), // 7 back bottom left

    // Stand (box)
    vec3(-0.1, -0.2,  0.05), // 8 front top left
    vec3( 0.1, -0.2,  0.05), // 9 front top right
    vec3( 0.1, -0.5,  0.05), // 10 front bottom right
    vec3(-0.1, -0.5,  0.05), // 11 front bottom left
    vec3(-0.1, -0.2, -0.05), // 12 back top left
    vec3( 0.1, -0.2, -0.05), // 13 back top right
    vec3( 0.1, -0.5, -0.05), // 14 back bottom right
    vec3(-0.1, -0.5, -0.05)  // 15 back bottom left
    ];

    var vertexColors = [
    // Screen: dark gray (8 vertices)
    vec4(0.2, 0.2, 0.2, 1.0),
    vec4(0.2, 0.2, 0.2, 1.0),
    vec4(0.2, 0.2, 0.2, 1.0),
    vec4(0.2, 0.2, 0.2, 1.0),
    vec4(0.2, 0.2, 0.2, 1.0),
    vec4(0.2, 0.2, 0.2, 1.0),
    vec4(0.2, 0.2, 0.2, 1.0),
    vec4(0.2, 0.2, 0.2, 1.0),
    // Stand: silver (8 vertices)
    vec4(0.7, 0.7, 0.7, 1.0),
    vec4(0.7, 0.7, 0.7, 1.0),
    vec4(0.7, 0.7, 0.7, 1.0),
    vec4(0.7, 0.7, 0.7, 1.0),
    vec4(0.7, 0.7, 0.7, 1.0),
    vec4(0.7, 0.7, 0.7, 1.0),
    vec4(0.7, 0.7, 0.7, 1.0),
    vec4(0.7, 0.7, 0.7, 1.0)
    ];

// indices of the 12 triangles that compise the cube

var indices = [
    // Screen front face
    0, 1, 2,
    0, 2, 3,
    // Screen back face
    4, 5, 6,
    4, 6, 7,
    // Screen left face
    0, 3, 7,
    0, 7, 4,
    // Screen right face
    1, 2, 6,
    1, 6, 5,
    // Screen top face
    0, 1, 5,
    0, 5, 4,
    // Screen bottom face
    3, 2, 6,
    3, 6, 7,

    // Stand front face
    8, 9, 10,
    8, 10, 11,
    // Stand back face
    12, 13, 14,
    12, 14, 15,
    // Stand left face
    8, 11, 15,
    8, 15, 12,
    // Stand right face
    9, 10, 14,
    9, 14, 13,
    // Stand top face
    8, 9, 13,
    8, 13, 12,
    // Stand bottom face
    11, 10, 14,
    11, 14, 15
];

init();

function init()
{
    canvas = document.getElementById("gl-canvas");

    gl = canvas.getContext('webgl2');
    if (!gl) alert("WebGL 2.0 isn't available");


    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(1.0, 1.0, 1.0, 1.0);

    gl.enable(gl.DEPTH_TEST);;

    //
    //  Load shaders and initialize attribute buffers
    //
    var program = initShaders(gl, "vertex-shader", "fragment-shader");
    gl.useProgram(program);

    // array element buffer

    var iBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array(indices), gl.STATIC_DRAW);

    // color array atrribute buffer

    var cBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(vertexColors), gl.STATIC_DRAW);

    var colorLoc = gl.getAttribLocation(program, "aColor");
    gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(colorLoc);

    // vertex array attribute buffer

    var vBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(vertices), gl.STATIC_DRAW);

    var positionLoc = gl.getAttribLocation( program, "aPosition");
    gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(positionLoc );

    MVMLoc = gl.getUniformLocation(program, "modelViewMatrix");
    window.uPositionLoc = gl.getUniformLocation(program, "uPosition");
    window.uRotationLoc = gl.getUniformLocation(program, "uRotation");
    window.uScaleLoc = gl.getUniformLocation(program, "uScale");

    //event listeners for buttons



    // Animation button and preset
    var animateBtn = document.getElementById('animate-btn');
    var presetSelect = document.getElementById('animation-preset');
    if (animateBtn) {
        animateBtn.addEventListener('click', function() {
            isAnimating = !isAnimating;
            animateBtn.textContent = isAnimating ? 'Stop Animation' : 'Animate';
        });
    }
    if (presetSelect) {
        presetSelect.addEventListener('change', function() {
            animationPreset = presetSelect.value;
        });
    }
    render();
}

function render()
{
    // Get background color from color input
    var bgColorInput = document.getElementById('bg-color');
    var bgColor = bgColorInput ? bgColorInput.value : '#ffffff';
    // Convert hex to RGB
    function hexToRgb(hex) {
        hex = hex.replace('#', '');
        var bigint = parseInt(hex, 16);
        var r = (bigint >> 16) & 255;
        var g = (bigint >> 8) & 255;
        var b = bigint & 255;
        return [r / 255, g / 255, b / 255, 1.0];
    }
    var rgb = hexToRgb(bgColor);
    gl.clearColor(rgb[0], rgb[1], rgb[2], rgb[3]);
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Get values from UI
    var posX = parseFloat(document.getElementById('position-x').value);
    var posY = parseFloat(document.getElementById('position-y').value);
    var posZ = parseFloat(document.getElementById('position-z').value);
    var rotX = parseFloat(document.getElementById('rotation-x').value) * Math.PI * 2;
    var rotY = parseFloat(document.getElementById('rotation-y').value) * Math.PI * 2;
    var rotZ = parseFloat(document.getElementById('rotation-z').value) * Math.PI * 2;
    var scale = parseFloat(document.getElementById('scale').value);

    // Animation logic
    if (isAnimating) {
        animationTime += 0.016; // ~60fps
        var preset = animationPreset;
        if (preset === 'spin') {
            rotY = animationTime % (2 * Math.PI);
            document.getElementById('rotation-y').value = (rotY / (2 * Math.PI)).toFixed(2);
            document.getElementById('rotation-y-value').textContent = (rotY / (2 * Math.PI)).toFixed(2);
        } else if (preset === 'bounce') {
            posY = 0.3 * Math.sin(animationTime * 2);
            document.getElementById('position-y').value = posY.toFixed(2);
            document.getElementById('position-y-value').textContent = posY.toFixed(2);
        } else if (preset === 'pulse') {
            scale = 0.8 + 0.2 * Math.sin(animationTime * 3);
            document.getElementById('scale').value = scale.toFixed(2);
            document.getElementById('scale-value').textContent = scale.toFixed(2);
        }
    }

    // Set uniforms
    gl.uniform3fv(uPositionLoc, [posX, posY, posZ]);
    gl.uniform3fv(uRotationLoc, [rotX, rotY, rotZ]);
    gl.uniform1f(uScaleLoc, scale);

    // Compose transformation matrix stack (for modelViewMatrix)
    ctm = mat4();
    ctm = mult(ctm, translate(posX, posY, posZ));
    ctm = mult(ctm, rotateX(rotX));
    ctm = mult(ctm, rotateY(rotY));
    ctm = mult(ctm, rotateZ(rotZ));
    ctm = mult(ctm, window.scale(scale, scale, scale));
    gl.uniformMatrix4fv(MVMLoc, false, flatten(ctm));

    // Wireframe mode toggle
    var wireframe = document.getElementById('wireframe-mode').checked;
    if (wireframe) {
        // Draw each triangle as lines
        for (var i = 0; i < indices.length; i += 3) {
            gl.drawElements(gl.LINE_LOOP, 3, gl.UNSIGNED_BYTE, i);
        }
    } else {
        gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_BYTE, 0);
    }

    requestAnimationFrame(render);
}
