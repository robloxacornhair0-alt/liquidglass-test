/**
 * webgl-render.js
 * Liquid Glass Effect Renderer
 */

// Vertex Shader: Passes coordinates and maps texture space
const vertexShaderSource = `
    attribute vec2 a_position;
    varying vec2 v_texCoord;
    void main() {
        // Map from square space to clip space
        gl_Position = vec4(a_position, 0.0, 1.0);
        // Map from clip space (-1 to 1) to texture coordinates (0 to 1)
        v_texCoord = a_position * 0.5 + 0.5;
    }
`;

// Fragment Shader: Handles multi-layer refraction, chromatic aberration, rim light, and blur distortion
const fragmentShaderSource = `
    precision mediump float;
    
    varying vec2 v_texCoord;
    
    // Uniforms
    uniform sampler2D u_sceneTexture;     // The captured background/page texture
    uniform vec2 u_resolution;            // Canvas resolution (width, height)
    uniform vec2 u_mouse;                 // Normalized mouse position (0 to 1)
    
    // Liquid Glass Parameters
    uniform float u_displacementScale;    // Intensity of the glass warp/refraction
    uniform float u_blurAmount;           // Frosting / blur factor
    uniform float u_saturation;           // Color saturation multiplier (e.g., 1.4)
    uniform float u_aberrationIntensity;  // RGB channel splitting separation
    uniform float u_elasticity;           // Lag/stretch deformation factor
    uniform float u_cornerRadius;         // Border rounding configuration

    // Simple pseudo-normal generator based on mouse proximity to simulate an organic liquid ripple
    vec2 getLiquidNormal(vec2 uv, vec2 mousePos, float elasticity) {
        vec2 toMouse = uv - mousePos;
        float dist = length(toMouse);
        // Create an elastic wave falloff profile
        float wave = sin(dist * 20.0 - elasticity) * exp(-dist * 5.0);
        return normalize(toMouse) * wave;
    }

    void main() {
        vec2 uv = v_texCoord;
        
        // 1. Calculate shape awareness and pseudo-normals for refraction
        vec2 normal = getLiquidNormal(uv, u_mouse, u_elasticity);
        
        // 2. Multi-layer refraction mapping with Chromatic Aberration (RGB Splitting)
        float split = u_aberrationIntensity * 0.005 * u_displacementScale;
        
        vec2 rUV = uv + normal * (u_displacementScale * 0.01 + split);
        vec2 gUV = uv + normal * (u_displacementScale * 0.01);
        vec2 bUV = uv + normal * (u_displacementScale * 0.01 - split);
        
        // Sample background scene texture across split coordinates
        float rChannel = texture2D(u_sceneTexture, rUV).r;
        float gChannel = texture2D(u_sceneTexture, gUV).g;
        float bChannel = texture2D(u_sceneTexture, bUV).b;
        
        vec3 finalColor = vec3(rChannel, gChannel, bChannel);
        
        // 3. Saturation enhancement
        float luma = dot(finalColor, vec3(0.299, 0.587, 0.114));
        finalColor = mix(vec3(luma), finalColor, u_saturation);
        
        // 4. Edge and Rim Lighting simulation
        float edgeLighting = smoothstep(0.4, 0.5, length(normal));
        finalColor += vec3(edgeLighting * 0.15); // Adds a subtle frosted white sheen to edges
        
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

export class LiquidGlassRenderer {
    constructor(canvas, sceneTextureSource) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!this.gl) {
            console.error('WebGL not supported in this browser.');
            return;
        }

        this.sceneTextureSource = sceneTextureSource; // Can be an Image, video, or another canvas (e.g., from html2canvas)
        this.mouse = { x: 0.5, y: 0.5 };
        
        // Default configuration values
        this.params = {
            displacementScale: 70.0,
            blurAmount: 0.0625,
            saturation: 1.4,
            aberrationIntensity: 2.0,
            elasticity: 0.15,
            cornerRadius: 999.0
        };

        this.init();
    }

    init() {
        const gl = this.gl;

        // Compile Shaders
        const vs = this.compileShader(vertexShaderSource, gl.VERTEX_SHADER);
        const fs = this.compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);
        
        // Link Program
        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Failed to link program:', gl.getProgramInfoLog(this.program));
            return;
        }

        // Setup geometry (A simple full-screen quad layout)
        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
            -1.0,  1.0,
             1.0, -1.0,
             1.0,  1.0,
        ]), gl.STATIC_DRAW);

        // Look up Uniform / Attribute locations
        this.locations = {
            position: gl.getAttribLocation(this.program, 'a_position'),
            resolution: gl.getUniformLocation(this.program, 'u_resolution'),
            mouse: gl.getUniformLocation(this.program, 'u_mouse'),
            sceneTexture: gl.getUniformLocation(this.program, 'u_sceneTexture'),
            displacementScale: gl.getUniformLocation(this.program, 'u_displacementScale'),
            blurAmount: gl.getUniformLocation(this.program, 'u_blurAmount'),
            saturation: gl.getUniformLocation(this.program, 'u_saturation'),
            aberrationIntensity: gl.getUniformLocation(this.program, 'u_aberrationIntensity'),
            elasticity: gl.getUniformLocation(this.program, 'u_elasticity'),
            cornerRadius: gl.getUniformLocation(this.program, 'u_cornerRadius'),
        };

        // Initialize background texture
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        // Set wrapping and filtering parameters for texture mapping
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    compileShader(source, type) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    updateMousePosition(x, y) {
        // Expecting normalized coordinates (0.0 to 1.0)
        this.mouse.x = x;
        this.mouse.y = y;
    }

    updateParams(newParams) {
        this.params = { ...this.params, ...newParams };
    }

    render() {
        const gl = this.gl;
        if (!gl) return;

        // Resize viewport dynamically to match canvas size
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);

        // Bind geometry attributes
        gl.enableVertexAttribArray(this.locations.position);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);

        // Update the WebGL texture from the source element (e.g. underlying container capture)
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        if (this.sceneTextureSource) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sceneTextureSource);
        }

        // Pass global variables / configurations as Uniforms to Shaders
        gl.uniform2f(this.locations.resolution, this.canvas.width, this.canvas.height);
        gl.uniform2f(this.locations.mouse, this.mouse.x, this.mouse.y);
        gl.uniform1i(this.locations.sceneTexture, 0); // Active texture unit 0

        // Pass dynamic parameter uniforms
        gl.uniform1f(this.locations.displacementScale, this.params.displacementScale);
        gl.uniform1f(this.locations.blurAmount, this.params.blurAmount);
        gl.uniform1f(this.locations.saturation, this.params.saturation);
        gl.uniform1f(this.locations.aberrationIntensity, this.params.aberrationIntensity);
        gl.uniform1f(this.locations.elasticity, this.params.elasticity);
        gl.uniform1f(this.locations.cornerRadius, this.params.cornerRadius);

        // Draw Fullscreen Quad
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
}
