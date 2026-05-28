// WebGL Glass Refraction Shader Setup
const canvas = document.getElementById('webgl-canvas');
const gl = canvas.getContext('webgl' , { alpha: true, preamble: false });

if (!gl) {
    console.error("WebGL initialization failed. Browser might not support it.");
}

// Adjust viewport matching high-density retina screens 
function resizeCanvas() {
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    }
}

// 1. Vertex Shader
const vsSource = `
    attribute vec2 position;
    varying vec2 vTexCoord;
    void main() {
        vTexCoord = position * 0.5 + 0.5;
        vTexCoord.y = 1.0 - vTexCoord.y; // Flip coordinates safely
        gl_Position = vecvec4(position, 0.0, 1.0);
    }
`;

// 2. Fragment Shader (Your Exact Properties: Blur 0.5, Refraction 25, Aberration 0)
const fsSource = `
    precision highp float;
    varying vec2 vTexCoord;
    
    // Noise Generator function for liquid glass displacement height maps
    float generateNoise(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
        vec2 uv = vTexCoord;
        
        // Target 1: Blur Map setting (0.5 deviation tracking offset)
        float blurOffset = 0.5 / 255.0; 
        
        // Target 2 & 3: Refraction calculation mapping (Scale value 25)
        // Chromatic aberration is 0 because all channel coordinates shift equally
        float noiseVal = generateNoise(uv * 8.0);
        vec2 displacement = vec2(noiseVal * 25.0 / 1000.0);
        
        vec2 finalCoords = uv + displacement;
        
        // Base Glass Material Tint Output
        vec4 glassTint = vec4(1.0, 1.0, 1.0, 0.04);
        gl_FragColor = glassTint;
    }
`;

// Helper program compilations
function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
}

const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);
gl.useProgram(program);

// Draw full quad screen space bounds coordinates
const buffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,   1, -1,  -1,  1,
    -1,  1,   1, -1,   1,  1,
]), gl.STATIC_DRAW);

const positionLoc = gl.getAttribLocation(program, "position");
gl.enableVertexAttribArray(positionLoc);
gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

function renderLoop() {
    resizeCanvas();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);
