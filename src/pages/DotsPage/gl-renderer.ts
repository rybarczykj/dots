// WebGL2 dot renderer: one instanced draw call for all dots. Each dot is a quad
// whose fragment shader evaluates the shape's signed distance field, so shape
// geometry here must mirror drawShape() in DotsCanvas.tsx. Instances draw in
// row-major order, so overlapping dots stack exactly like the p5 renderer.
import { DotLayout, SHAPE_NAMES, ShapeName } from './dot-layout';

const DOTS_VS = `#version 300 es
in vec2 aCorner;
in float aSize;
in vec4 aColor;
// Visible region in CSS px: origin and size (a tile of the frame when exporting large images)
uniform vec2 uOrigin;
uniform vec2 uCanvas;
uniform float uSpacing;
uniform int uCols;
uniform float uDpr;
out vec2 vLocal;
out float vSize;
out vec4 vColor;
void main() {
    if (aSize <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
        return;
    }
    vec2 cell = vec2(float(gl_InstanceID % uCols), float(gl_InstanceID / uCols));
    vec2 center = cell * uSpacing + uSpacing * 0.5;
    // Pad by one device pixel so antialiased edges aren't clipped
    vec2 local = aCorner * (aSize * 0.5 + 1.0 / uDpr);
    vec2 pos = center + local;
    vLocal = local;
    vSize = aSize;
    vColor = aColor;
    vec2 p = pos - uOrigin;
    gl_Position = vec4(p.x / uCanvas.x * 2.0 - 1.0, 1.0 - p.y / uCanvas.y * 2.0, 0.0, 1.0);
}`;

const DOTS_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vSize;
in vec4 vColor;
uniform int uShape;
uniform float uDpr;
out vec4 outColor;

float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
    vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
    vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
    vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
    vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
    vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
    float s = sign(e0.x * e2.y - e0.y * e2.x);
    vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                     vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                     vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
    return -sqrt(d.x) * sign(d.y);
}

void main() {
    vec2 p = vLocal;
    float s = vSize;
    float h = s * 0.5;
    float d;
    if (uShape == 0) {
        d = length(p) - h;
    } else if (uShape == 1) {
        d = sdBox(p, vec2(h));
    } else if (uShape == 2) {
        // Square of side 0.7*size rotated 45 degrees
        vec2 q = vec2(p.x + p.y, p.y - p.x) * 0.70710678;
        d = sdBox(q, vec2(s * 0.35));
    } else if (uShape == 3) {
        d = sdTriangle(p, vec2(0.0, -h), vec2(-h, h * 0.6), vec2(h, h * 0.6));
    } else if (uShape == 4) {
        d = min(sdBox(p, vec2(h, s * 0.15)), sdBox(p, vec2(s * 0.15, h)));
    } else {
        // Stroke of weight 0.15*size on a circle of diameter 0.85*size
        d = abs(length(p) - s * 0.425) - s * 0.075;
    }
    float alpha = clamp(0.5 - d * uDpr, 0.0, 1.0);
    if (alpha <= 0.0) discard;
    outColor = vec4(vColor.rgb * alpha, alpha);
}`;

const BG_VS = `#version 300 es
in vec2 aCorner;
// Visible region and full background size, in CSS px
uniform vec2 uOrigin;
uniform vec2 uView;
uniform vec2 uBgSize;
out vec2 vUv;
void main() {
    vUv = (uOrigin + vec2(aCorner.x * 0.5 + 0.5, 0.5 - aCorner.y * 0.5) * uView) / uBgSize;
    gl_Position = vec4(aCorner, 0.0, 1.0);
}`;

const BG_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
    outColor = vec4(texture(uTex, vUv).rgb, 1.0);
}`;

export type GLBackgroundSource = TexImageSource;

const compile = (gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram => {
    const program = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(shader));
        }
        gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error('Program link failed: ' + gl.getProgramInfoLog(program));
    }
    return program;
};

export class DotsGLRenderer {
    private gl: WebGL2RenderingContext;
    private dotsProgram: WebGLProgram;
    private bgProgram: WebGLProgram;
    private dotsVao: WebGLVertexArrayObject;
    private bgVao: WebGLVertexArrayObject;
    private sizeBuffer: WebGLBuffer;
    private colorBuffer: WebGLBuffer;
    private bgTexture: WebGLTexture;
    private uniforms: Record<string, WebGLUniformLocation | null>;
    private maxTextureSize: number;
    private fitCanvas: HTMLCanvasElement | null = null;
    /** Last uploaded background; still images and canvases are re-uploaded only when this changes */
    private uploadedBackground: GLBackgroundSource | null = null;

    /** `transparent`: clear to transparent instead of white (PNG export with alpha) */
    constructor(canvas: HTMLCanvasElement, private transparent = false) {
        const gl = canvas.getContext('webgl2', {
            alpha: transparent,
            antialias: false,
            premultipliedAlpha: true,
            preserveDrawingBuffer: true,
        });
        if (!gl) throw new Error('WebGL2 not available');
        this.gl = gl;

        this.dotsProgram = compile(gl, DOTS_VS, DOTS_FS);
        this.bgProgram = compile(gl, BG_VS, BG_FS);

        const quad = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

        // Dots: shared quad corners + per-instance size and color
        this.dotsVao = gl.createVertexArray()!;
        gl.bindVertexArray(this.dotsVao);
        const dCorner = gl.getAttribLocation(this.dotsProgram, 'aCorner');
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(dCorner);
        gl.vertexAttribPointer(dCorner, 2, gl.FLOAT, false, 0, 0);

        this.sizeBuffer = gl.createBuffer()!;
        const aSize = gl.getAttribLocation(this.dotsProgram, 'aSize');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
        gl.enableVertexAttribArray(aSize);
        gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(aSize, 1);

        this.colorBuffer = gl.createBuffer()!;
        const aColor = gl.getAttribLocation(this.dotsProgram, 'aColor');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.enableVertexAttribArray(aColor);
        gl.vertexAttribPointer(aColor, 4, gl.UNSIGNED_BYTE, true, 0, 0);
        gl.vertexAttribDivisor(aColor, 1);

        // Background: full-canvas quad
        this.bgVao = gl.createVertexArray()!;
        gl.bindVertexArray(this.bgVao);
        const bCorner = gl.getAttribLocation(this.bgProgram, 'aCorner');
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(bCorner);
        gl.vertexAttribPointer(bCorner, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);

        this.bgTexture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, this.bgTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        this.uniforms = {};
        for (const name of ['uOrigin', 'uCanvas', 'uSpacing', 'uCols', 'uDpr', 'uShape']) {
            this.uniforms[name] = gl.getUniformLocation(this.dotsProgram, name);
        }
        for (const name of ['uTex', 'uOrigin', 'uView', 'uBgSize']) {
            this.uniforms[`bg_${name}`] = gl.getUniformLocation(this.bgProgram, name);
        }
        this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    }

    render(opts: {
        width: number;
        height: number;
        dpr: number;
        background: GLBackgroundSource | null;
        layout: DotLayout | null;
        shape: ShapeName;
        /** Exact output size in device pixels (export); defaults to floor(size * dpr) */
        pixelWidth?: number;
        pixelHeight?: number;
        /** Render only this region of the frame, in device pixels (tiled export of huge images) */
        tile?: { x: number; y: number; width: number; height: number };
    }) {
        const { gl } = this;
        const canvas = gl.canvas as HTMLCanvasElement;
        // Truncate like a 2D canvas (and p5) does with fractional sizes
        const pxWidth = opts.pixelWidth ?? Math.floor(opts.width * opts.dpr);
        const pxHeight = opts.pixelHeight ?? Math.floor(opts.height * opts.dpr);
        const tile = opts.tile ?? { x: 0, y: 0, width: pxWidth, height: pxHeight };
        if (canvas.width !== tile.width || canvas.height !== tile.height) {
            canvas.width = tile.width;
            canvas.height = tile.height;
        }
        gl.viewport(0, 0, tile.width, tile.height);
        // Visible region in CSS px, so 1 unit = dpr device pixels even after truncation
        const originX = tile.x / opts.dpr;
        const originY = tile.y / opts.dpr;
        const viewWidth = tile.width / opts.dpr;
        const viewHeight = tile.height / opts.dpr;
        if (this.transparent) gl.clearColor(0, 0, 0, 0);
        else gl.clearColor(1, 1, 1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        if (opts.background) {
            gl.disable(gl.BLEND);
            gl.useProgram(this.bgProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.bgTexture);
            // Video frames change every render; anything else only when the source object does
            // (re-uploading a 12 MP photo per slider tick was the main cost on images)
            if (opts.background !== this.uploadedBackground || opts.background instanceof HTMLVideoElement) {
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.fitToTexture(opts.background));
                this.uploadedBackground = opts.background;
            }
            gl.uniform1i(this.uniforms.bg_uTex, 0);
            gl.uniform2f(this.uniforms.bg_uOrigin, originX, originY);
            gl.uniform2f(this.uniforms.bg_uView, viewWidth, viewHeight);
            // Background spans the untruncated size; the viewport may crop its edge
            gl.uniform2f(this.uniforms.bg_uBgSize, opts.width, opts.height);
            gl.bindVertexArray(this.bgVao);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        const layout = opts.layout;
        if (layout && layout.sizes.length > 0) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.useProgram(this.dotsProgram);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, layout.sizes, gl.DYNAMIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, layout.colors, gl.DYNAMIC_DRAW);
            gl.uniform2f(this.uniforms.uOrigin, originX, originY);
            gl.uniform2f(this.uniforms.uCanvas, viewWidth, viewHeight);
            gl.uniform1f(this.uniforms.uSpacing, layout.dotSpacing);
            gl.uniform1i(this.uniforms.uCols, layout.cols);
            gl.uniform1f(this.uniforms.uDpr, opts.dpr);
            gl.uniform1i(this.uniforms.uShape, SHAPE_NAMES.indexOf(opts.shape));
            gl.bindVertexArray(this.dotsVao);
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, layout.sizes.length);
        }
        gl.bindVertexArray(null);
    }

    /**
     * Sources larger than the GPU's max texture size fail to upload and sample black,
     * so shrink them to fit first (a 2D canvas has no such limit).
     */
    private fitToTexture(source: GLBackgroundSource): GLBackgroundSource {
        const [width, height] =
            source instanceof HTMLVideoElement
                ? [source.videoWidth, source.videoHeight]
                : source instanceof HTMLImageElement
                ? [source.naturalWidth, source.naturalHeight]
                : typeof VideoFrame !== 'undefined' && source instanceof VideoFrame
                ? [source.displayWidth, source.displayHeight]
                : [source.width, source.height];
        const scale = Math.min(1, this.maxTextureSize / Math.max(width, height));
        if (scale >= 1) return source;
        this.fitCanvas ??= document.createElement('canvas');
        this.fitCanvas.width = Math.floor(width * scale);
        this.fitCanvas.height = Math.floor(height * scale);
        this.fitCanvas.getContext('2d')!.drawImage(source as CanvasImageSource, 0, 0, this.fitCanvas.width, this.fitCanvas.height);
        return this.fitCanvas;
    }

    /** Throws if the last render didn't make it (GPU out of memory or context lost) */
    assertRendered() {
        const { gl } = this;
        if (gl.isContextLost()) {
            throw new Error('GPU reset during export. Try again, or try a smaller size.');
        }
        // getError returns one queued error per call; drain them all
        const errors = new Set<number>();
        for (let e = gl.getError(); e !== gl.NO_ERROR && errors.size < 8; e = gl.getError()) errors.add(e);
        if (errors.has(gl.OUT_OF_MEMORY)) {
            throw new Error('GPU ran out of memory at this size. Try a smaller size.');
        }
        if (errors.size > 0) {
            throw new Error(`GPU render failed (error ${Array.from(errors).join(', ')}). Try a smaller size.`);
        }
        const canvas = gl.canvas as HTMLCanvasElement;
        if (gl.drawingBufferWidth !== canvas.width || gl.drawingBufferHeight !== canvas.height) {
            throw new Error('GPU could not allocate this size. Try a smaller size.');
        }
    }

    dispose() {
        this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
}
