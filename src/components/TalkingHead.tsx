/**
 * TalkingHead — Crimson Skeleton.
 *
 * Two-pass render (borrowed from the original proven approach, upgraded):
 *   1. Dark solid skin with crimson fresnel rim glow → silhouette that breathes
 *   2. Crimson wireframe overlay (additive) → topology you can see, no cage
 *   3. Particle aura (amber → crimson, additive) → magical ambience
 *   4. Cinematic 3-point rig (crimson key, cool fill, warm rim)
 *   5. Voice-reactive uniforms driving emissive + bloom feel
 *
 * Zero CSS radial gradients on the background — pure black. Any "glow" is
 * shader-driven so it reads as real light, not a filter blob.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

export interface AudioTimings {
  words: string[]
  wtimes: number[]
  wdurations: number[]
}

export interface TalkingHeadHandle {
  speak: (text: string) => void
  speakWithAudio: (audioUrl: string, timings: AudioTimings) => void
  stopSpeaking: () => void
  warmUpAudio: () => void
}

const AVATAR_URL = '/avatars/avatarsdk.glb'

// ────────────────────────────────────────────────────────────────
// Skin pass: very dark base with crimson rim. Tuned so the figure is
// mostly silhouette, emerging from black only at its edges.
// ────────────────────────────────────────────────────────────────
const SKIN_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPos;

  #ifdef USE_SKINNING
    #include <skinning_pars_vertex>
  #endif
  #ifdef USE_MORPHTARGETS
    #include <morphtarget_pars_vertex>
  #endif

  void main() {
    #include <beginnormal_vertex>
    #ifdef USE_MORPHTARGETS
      #include <morphnormal_vertex>
    #endif
    #ifdef USE_SKINNING
      #include <skinbase_vertex>
      #include <skinnormal_vertex>
    #endif
    #include <defaultnormal_vertex>

    #include <begin_vertex>
    #ifdef USE_MORPHTARGETS
      #include <morphtarget_vertex>
    #endif
    #ifdef USE_SKINNING
      #include <skinning_vertex>
    #endif

    vec4 mvPos = viewMatrix * modelMatrix * vec4(transformed, 1.0);
    vNormal  = normalize(normalMatrix * objectNormal);
    vViewPos = -mvPos.xyz;

    gl_Position = projectionMatrix * mvPos;
  }
`

const SKIN_FRAG = /* glsl */ `
  precision highp float;

  varying vec3 vNormal;
  varying vec3 vViewPos;

  uniform vec3  uBase;      // very dark — almost black
  uniform vec3  uRim;       // crimson
  uniform float uRimPower;
  uniform float uRimGain;
  uniform float uAudio;     // 0..1
  uniform float uTime;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewPos);

    float wrap = clamp(dot(N, normalize(vec3(0.3, 0.6, 0.8))) * 0.5 + 0.5, 0.0, 1.0);
    vec3  base = uBase * (0.2 + 0.4 * wrap);

    float fres = pow(1.0 - max(dot(N, V), 0.0), uRimPower);
    // Breath pulse while idle, big surge while speaking
    float pulse = 0.85 + 0.15 * sin(uTime * 0.7);
    vec3 rim = uRim * fres * (uRimGain * pulse + uAudio * 2.2);

    vec3 color = base + rim;

    // Cheap filmic-ish curve so the rim doesn't clip to white
    color = color / (color + vec3(0.55));
    color = pow(color, vec3(1.0 / 2.2));

    gl_FragColor = vec4(color, 1.0);
  }
`

// ────────────────────────────────────────────────────────────────
// Wireframe pass: thin crimson lines, additive. Alpha-modulated by
// fresnel so back-facing triangles fade instead of forming a cage.
// ────────────────────────────────────────────────────────────────
const WIRE_VERT = SKIN_VERT

const WIRE_FRAG = /* glsl */ `
  precision highp float;

  varying vec3 vNormal;
  varying vec3 vViewPos;

  uniform vec3  uColor;
  uniform float uAudio;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewPos);
    // Fresnel weight — edges brighter, back-facing wire dimmer.
    float f = pow(max(dot(N, V), 0.0), 0.7);
    float alpha = (0.35 + 0.55 * f) + uAudio * 0.35;
    gl_FragColor = vec4(uColor * (1.0 + uAudio * 0.9), alpha);
  }
`

type UniformsBag = {
  skin: Record<string, { value: any }>
  wire: Record<string, { value: any }>
  aura: Record<string, { value: any }>
}

function buildSkinMaterial(THREE: typeof import('three'), uniformsOut: { current: UniformsBag | null }) {
  const skin = {
    uBase:     { value: new THREE.Color('#0E0908') },
    uRim:      { value: new THREE.Color('#FF1A26') },
    uRimPower: { value: 2.6 },
    uRimGain:  { value: 1.15 },
    uAudio:    { value: 0 },
    uTime:     { value: 0 },
  }
  const mat = new THREE.ShaderMaterial({
    vertexShader:   SKIN_VERT,
    fragmentShader: SKIN_FRAG,
    uniforms:       skin,
    side:           THREE.FrontSide,
  })
  ;(mat as any).skinning     = true
  ;(mat as any).morphTargets = true

  uniformsOut.current = {
    skin,
    wire: {
      uColor: { value: new THREE.Color('#FF2A36') },
      uAudio: skin.uAudio,
    },
    aura: {
      uTime:  { value: 0 },
      uAudio: skin.uAudio,
    },
  }
  return mat
}

function buildWireMaterial(THREE: typeof import('three'), bag: UniformsBag) {
  const mat = new THREE.ShaderMaterial({
    vertexShader:   WIRE_VERT,
    fragmentShader: WIRE_FRAG,
    uniforms:       bag.wire,
    wireframe:      true,
    transparent:    true,
    depthWrite:     false,
    depthTest:      true,
    blending:       THREE.AdditiveBlending,
    side:           THREE.FrontSide,
  })
  ;(mat as any).skinning     = true
  ;(mat as any).morphTargets = true
  return mat
}

const TalkingHeadComponent = forwardRef<TalkingHeadHandle>((_, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headRef = useRef<any>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const uniformsRef = useRef<UniformsBag | null>(null)
  const rafRef = useRef<number | null>(null)

  function getAudioContext(): AudioContext {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
    if (audioCtxRef.current.state === 'suspended') void audioCtxRef.current.resume()
    if (headRef.current?.audioCtx?.state === 'suspended') void headRef.current.audioCtx.resume()
    return audioCtxRef.current
  }

  useImperativeHandle(ref, () => ({
    speak(_text: string) {},
    warmUpAudio() {
      getAudioContext()
      if (headRef.current?.audioCtx?.state === 'suspended') void headRef.current.audioCtx.resume()
    },
    stopSpeaking() {
      headRef.current?.stopSpeaking()
      headRef.current?.setMood('neutral')
      if (uniformsRef.current) uniformsRef.current.skin.uAudio.value = 0
    },
    async speakWithAudio(audioUrl, timings) {
      if (!headRef.current) return
      try {
        const audioCtx = getAudioContext()
        const response = await fetch(audioUrl)
        const arrayBuffer = await response.arrayBuffer()
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)

        headRef.current.setMood('happy')

        if (!analyserRef.current && headRef.current.audioCtx) {
          const analyser = headRef.current.audioCtx.createAnalyser()
          analyser.fftSize = 128
          analyser.smoothingTimeConstant = 0.78
          if (headRef.current.audioGain) headRef.current.audioGain.connect(analyser)
          analyserRef.current = analyser
        }

        headRef.current.speakAudio(
          {
            audio:     audioBuffer,
            words:     timings.words,
            wtimes:    timings.wtimes,
            wdurations: timings.wdurations,
            visemes:   [],
          },
          {},
          undefined,
        )

        const durationMs = timings.wtimes.at(-1)! + timings.wdurations.at(-1)!
        setTimeout(() => {
          headRef.current?.setMood('neutral')
          if (uniformsRef.current) uniformsRef.current.skin.uAudio.value = 0
        }, durationMs + 500)
      } catch (err) {
        console.error('[TalkingHead] speakWithAudio failed:', err)
      }
    },
  }))

  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current
    let cancelled = false

    ;(async () => {
      try {
        const [{ TalkingHead }, THREE] = await Promise.all([
          import('@met4citizen/talkinghead'),
          import('three'),
        ])
        if (cancelled) return

        const head = new TalkingHead(container, {
          cameraView:  'head',
          cameraRotateEnable: false,
          lipsyncModules: [],
          lipsyncLang: 'en',
          avatarMood:  'neutral',
          avatarIdleEyeContact:  0.7,
          avatarIdleHeadMove:    0.5,
          avatarSpeakingEyeContact: 0.8,
          avatarSpeakingHeadMove:   0.7,
        })

        await head.showAvatar(
          { url: AVATAR_URL, lipsyncLang: 'en' },
          (e: { lengthComputable: boolean; loaded: number; total: number }) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100)
              const el = container.querySelector<HTMLElement>('[data-loading]')
              if (el) el.textContent = `igniting · ${pct}%`
            }
          },
        )
        if (cancelled) return

        // ── Build materials + swap ──
        const skinMat = buildSkinMaterial(THREE, uniformsRef)
        const wireMat = buildWireMaterial(THREE, uniformsRef.current!)

        const morphPairs: Array<{ original: any; clone: any }> = []
        const clonesToAdd: Array<{ clone: any; parent: any }> = []

        head.armature.traverse((child: any) => {
          if (!child.isMesh) return
          // Pass 1: dark skin on the original
          child.material = skinMat
          child.renderOrder = 0
          child.castShadow = false
          child.receiveShadow = false

          // Pass 2: wireframe clone, additive blended on top
          const wireClone = child.clone()
          wireClone.material = wireMat
          wireClone.renderOrder = 1
          if (child.isSkinnedMesh) {
            wireClone.bind(child.skeleton, child.bindMatrix.clone())
          }
          clonesToAdd.push({ clone: wireClone, parent: child.parent })

          if (child.morphTargetInfluences?.length) {
            morphPairs.push({ original: child, clone: wireClone })
          }
        })
        clonesToAdd.forEach(({ clone, parent }) => parent.add(clone))

        // Dampen any default lights the library added
        head.scene.traverse((obj: any) => {
          if (obj.isLight) obj.intensity *= 0.25
        })

        // ── Cinematic 3-point rig ──
        const key  = new THREE.DirectionalLight(0xff1a26, 1.6)
        key.position.set(-1.2, 1.5, 1.4)
        const fill = new THREE.DirectionalLight(0x5577aa, 0.2)
        fill.position.set(1.3, 0.7, 0.9)
        const rim  = new THREE.DirectionalLight(0xff4a2b, 0.8)
        rim.position.set(0.15, 1.1, -2.1)
        const ambient = new THREE.AmbientLight(0x120606, 0.4)
        head.scene.add(key, fill, rim, ambient)

        // ── Particle aura ──
        const PARTICLE_COUNT = 1100
        const positions = new Float32Array(PARTICLE_COUNT * 3)
        const seeds     = new Float32Array(PARTICLE_COUNT)
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const theta = Math.random() * Math.PI * 2
          const phi   = Math.acos(2 * Math.random() - 1)
          const r     = 0.5 + Math.random() * 0.7
          positions[i * 3 + 0] = Math.sin(phi) * Math.cos(theta) * r
          positions[i * 3 + 1] = Math.cos(phi) * r + 1.55
          positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r
          seeds[i] = Math.random()
        }
        const partGeo = new THREE.BufferGeometry()
        partGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        partGeo.setAttribute('aSeed',    new THREE.BufferAttribute(seeds, 1))

        const partMat = new THREE.ShaderMaterial({
          uniforms: uniformsRef.current!.aura,
          vertexShader: /* glsl */ `
            attribute float aSeed;
            uniform float uTime;
            uniform float uAudio;
            varying float vAlpha;
            void main() {
              vec3 p = position;
              float t = uTime * (0.22 + aSeed * 0.55) + aSeed * 6.28;
              p.x += sin(t) * 0.07;
              p.y += cos(t * 1.15) * 0.05;
              p.z += sin(t * 0.85) * 0.06;
              vec4 mv = modelViewMatrix * vec4(p, 1.0);
              gl_Position = projectionMatrix * mv;
              gl_PointSize = (1.4 + aSeed * 1.8 + uAudio * 2.6) * (220.0 / -mv.z);
              vAlpha = 0.3 + 0.55 * sin(t * 2.1 + aSeed * 8.0);
            }
          `,
          fragmentShader: /* glsl */ `
            precision highp float;
            varying float vAlpha;
            void main() {
              vec2 uv = gl_PointCoord - 0.5;
              float d = length(uv);
              if (d > 0.5) discard;
              float a = smoothstep(0.5, 0.0, d) * vAlpha;
              vec3 col = mix(vec3(1.0, 0.55, 0.18), vec3(1.0, 0.12, 0.14), d * 2.2);
              gl_FragColor = vec4(col, a);
            }
          `,
          transparent: true,
          depthWrite:  false,
          blending:    THREE.AdditiveBlending,
        })
        const particles = new THREE.Points(partGeo, partMat)
        head.scene.add(particles)

        // ── Uniform updater + morph sync ──
        const amps = new Uint8Array(64)
        const clock = new THREE.Clock()

        function syncMorphs() {
          for (const { original, clone } of morphPairs) {
            if (original.morphTargetInfluences && clone.morphTargetInfluences) {
              for (let i = 0; i < original.morphTargetInfluences.length; i++) {
                clone.morphTargetInfluences[i] = original.morphTargetInfluences[i]
              }
            }
          }
        }

        function tick() {
          if (cancelled) return
          const t = clock.getElapsedTime()
          const u = uniformsRef.current
          if (u) {
            u.skin.uTime.value = t
            u.aura.uTime.value = t

            let amp = 0
            const analyser = analyserRef.current
            if (analyser) {
              analyser.getByteFrequencyData(amps)
              let s = 0
              for (let i = 0; i < amps.length; i++) s += amps[i]
              amp = Math.min(1, s / (amps.length * 210))
            }
            const cur = u.skin.uAudio.value as number
            u.skin.uAudio.value = cur + (amp - cur) * 0.28
          }
          syncMorphs()

          // subtle cinematic sway
          if (head.camera) {
            head.camera.position.x = Math.sin(t * 0.16) * 0.028
            head.camera.position.y = 1.65 + Math.sin(t * 0.21) * 0.014
          }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)

        head.renderer.setClearColor(0x000000, 1)

        const overlay = container.querySelector<HTMLElement>('[data-loading]')
        if (overlay) overlay.style.display = 'none'

        const resumeAudio = () => {
          if (head.audioCtx?.state === 'suspended') void head.audioCtx.resume()
          document.removeEventListener('click', resumeAudio)
          document.removeEventListener('touchstart', resumeAudio)
          document.removeEventListener('keydown', resumeAudio)
        }
        document.addEventListener('click', resumeAudio)
        document.addEventListener('touchstart', resumeAudio)
        document.addEventListener('keydown', resumeAudio)

        headRef.current = head
      } catch (err) {
        console.error('[TalkingHead] init failed:', err)
        const el = container.querySelector<HTMLElement>('[data-loading]')
        if (el) el.textContent = 'avatar failed to load'
      }
    })()

    return () => {
      cancelled = true
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      headRef.current = null
      analyserRef.current = null
      uniformsRef.current = null
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-black"
      aria-label="Firefly — animated avatar narrating your answer"
    >
      <div
        data-loading
        className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[11px] tracking-[0.32em] uppercase text-crimson loading-breathe"
      >
        igniting · 0%
      </div>
      {/* Edge-only vignette — pulls the frame in. No center glow, no color bleed. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.8) 100%)',
        }}
      />
    </div>
  )
})

TalkingHeadComponent.displayName = 'TalkingHead'

export default TalkingHeadComponent
