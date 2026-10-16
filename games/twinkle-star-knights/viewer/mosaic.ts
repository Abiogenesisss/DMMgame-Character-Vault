import * as PIXI from 'pixi.js';

const vertex = `
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform mat3 uTextureMatrix;
varying vec2 vTextureCoord;
void main() {
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vTextureCoord = (uTextureMatrix * vec3(aTextureCoord, 1.0)).xy;
}`;

const fragment = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D uScene;
uniform vec2 uFrameSize;
uniform vec4 uColor;
void main() {
  // Average three samples on an 80-cell screen grid; the atlas supplies coverage.
  vec2 uv = floor(gl_FragCoord.xy / uFrameSize * 80.0) / 80.0;
  vec4 scene = (texture2D(uScene, uv) + texture2D(uScene, uv + vec2(0.01))
    + texture2D(uScene, uv - vec2(0.01))) / 3.0;
  float coverage = texture2D(uSampler, vTextureCoord).a * uColor.a;
  gl_FragColor = scene * coverage;
}`;

let program;

export class MosaicCapture {
  declare texture: any;
  declare mosaicSourcePass: any;
  declare shader: any;

  capture(renderer) {
    // Flush earlier slots so the copy contains the scene below this mask.
    // Copy to a separate texture; sampling the active framebuffer is invalid.
    renderer.batch.flush();
    const { width, height } = renderer.framebuffer.size;
    if (!this.texture) {
      this.texture = PIXI.RenderTexture.create({ width, height, resolution: 1,
        scaleMode: PIXI.SCALE_MODES.LINEAR, alphaMode: PIXI.ALPHA_MODES.PMA });
    } else if (this.texture.width !== width || this.texture.height !== height) {
      this.texture.resize(width, height);
    }
    renderer.texture.bind(this.texture.baseTexture, 0);
    renderer.gl.copyTexSubImage2D(renderer.gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
    return this.texture;
  }
  attach(mesh, { renderSource = false }: any = {}) {
    // Censored attachments can carry their own underlying artwork.
    // Draw it before capturing and covering the scene with mosaic pixels.
    mesh.mosaicSourcePass ||= renderSource;
    if (mesh.gameMosaic) return;
    mesh.gameMosaic = true;
    const sourceShader = mesh.shader;
    program ||= PIXI.Program.from(vertex, fragment, 'game-spine-mosaic');
    mesh.shader = new PIXI.MeshMaterial(mesh.texture, { program, uniforms: {
      uScene: PIXI.Texture.EMPTY, uFrameSize: new Float32Array(2)
    } });
    const render = mesh._render;
    const capture = this;
    mesh._render = function(renderer) {
      if (this.mosaicSourcePass) {
        const maskShader = this.shader;
        sourceShader.texture = maskShader.texture;
        sourceShader.tint = maskShader.tint;
        this.shader = sourceShader;
        try {
          render.call(this, renderer);
          renderer.batch.flush();
        } finally { this.shader = maskShader; }
      }
      const scene = capture.capture(renderer);
      this.shader.uniforms.uScene = scene;
      this.shader.uniforms.uFrameSize[0] = scene.width;
      this.shader.uniforms.uFrameSize[1] = scene.height;
      render.call(this, renderer);
    };
  }
  destroy() {
    this.texture?.destroy(true);
    this.texture = null;
  }
}
