// A small writer for Rive runtime files (.riv, format 7).
//
// It covers what Rythm Architect's animations need: artboards, nodes, shapes (rectangles, ellipses,
// straight-edged paths), fills, strokes, trim paths, keyframed animations with cubic easing, and
// state machines with number, boolean and trigger inputs. Type and property keys come from
// defs.json, extracted from rive-runtime's generated headers by extract-defs.mjs.
//
// Format notes (from rive-runtime src/file.cpp and runtime_header.hpp):
//   header  = "RIVE", varuint major, varuint minor, varuint fileId,
//             property keys (varuint each, 0-terminated), then 2-bit field types packed 4 per uint32
//   object  = varuint typeKey, then (varuint propertyKey, value)*, then varuint 0
//   values  = uint/id: varuint · bool: 1 byte · double: float32 LE · color: uint32 LE ·
//             string: varuint length + UTF-8
//   Component ids and keyed object ids are indices into the artboard's object list (artboard = 0).
//   Keyframe interpolators also take artboard slots. Animation state ids index the artboard's
//   animations, transition targets index the layer's states, condition inputs index the machine's
//   inputs.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const defs = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'defs.json'), 'utf8'));
const CLASSES = defs.classes;

// Resolves a property name on a class by walking up its parents.
function lookup(cls, prop) {
  for (let c = cls; c && CLASSES[c]; c = CLASSES[c].parent) {
    const p = CLASSES[c].properties[prop];
    if (p) return p;
  }
  throw new Error(`Rive: ${cls} has no property "${prop}"`);
}

function typeKeyOf(cls) {
  const c = CLASSES[cls];
  if (!c || c.typeKey == null) throw new Error(`Rive: unknown object type ${cls}`);
  return c.typeKey;
}

class Bytes {
  constructor() { this.buf = []; }
  byte(b) { this.buf.push(b & 0xff); }
  varuint(n) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`Rive: bad varuint ${n}`);
    do {
      let b = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) b |= 0x80;
      this.byte(b);
    } while (n > 0);
  }
  float32(v) {
    const f = new DataView(new ArrayBuffer(4));
    f.setFloat32(0, v, true);
    for (let i = 0; i < 4; i++) this.byte(f.getUint8(i));
  }
  uint32(v) {
    const f = new DataView(new ArrayBuffer(4));
    f.setUint32(0, v >>> 0, true);
    for (let i = 0; i < 4; i++) this.byte(f.getUint8(i));
  }
  string(s) {
    const enc = new TextEncoder().encode(s);
    this.varuint(enc.length);
    for (const b of enc) this.byte(b);
  }
  toUint8Array() { return Uint8Array.from(this.buf); }
}

// Colours are written as 0xAARRGGBB. Accepts '#rrggbb', '#rrggbbaa' or a number.
export function color(c, alpha = 1) {
  if (typeof c === 'number') return c >>> 0;
  const hex = c.replace('#', '');
  const rgb = parseInt(hex.slice(0, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : Math.round(alpha * 255);
  return ((a << 24) | rgb) >>> 0;
}

// Object types whose sibling order is draw order.
const DRAWABLE = new Set(['Node', 'Shape']);

let refCounter = 0;
class Ref {
  constructor(cls, props) { this.cls = cls; this.props = props; this.uid = ++refCounter; this.index = -1; }
}

// Common cubic easings (CSS-style control points).
export const EASE = {
  linear: null,
  out: [0.16, 1, 0.3, 1],
  inOut: [0.65, 0, 0.35, 1],
  in: [0.7, 0, 0.84, 0],
  back: [0.34, 1.56, 0.64, 1],
  soft: [0.25, 0.1, 0.25, 1],
  slam: [0.55, 0, 1, 0.45],
};

export class Artboard {
  constructor(file, { name = 'Artboard', width, height, clip = true }) {
    this.file = file;
    this.self = new Ref('Artboard', { name, width, height, clip, originX: 0, originY: 0 });
    this.self.index = 0;
    this.objects = [this.self];
    this.interpolators = new Map(); // key "x1,y1,x2,y2" -> Ref
    this.animations = [];
    this.machines = [];
    this.width = width;
    this.height = height;
  }

  add(cls, props, parent) {
    const p = { ...props };
    if (parent !== undefined) p.parentId = parent;
    const ref = new Ref(cls, p);
    ref.index = this.objects.length;
    this.objects.push(ref);
    return ref;
  }

  parentOf(parent) { return parent ? parent : this.self; }

  node(parent, props = {}) {
    return this.add('Node', { x: 0, y: 0, ...props }, this.parentOf(parent));
  }

  // A shape is a drawable container for paths and paints.
  shape(parent, props = {}) {
    return this.add('Shape', { x: 0, y: 0, ...props }, this.parentOf(parent));
  }

  rect(shape, { x = 0, y = 0, w, h, r = 0, originX = 0, originY = 0, name }) {
    const props = { x, y, width: w, height: h, originX, originY, linkCornerRadius: true, cornerRadiusTL: r };
    if (name) props.name = name;
    return this.add('Rectangle', props, shape);
  }

  ellipse(shape, { x = 0, y = 0, w, h, originX = 0.5, originY = 0.5, name }) {
    const props = { x, y, width: w, height: h, originX, originY };
    if (name) props.name = name;
    return this.add('Ellipse', props, shape);
  }

  // Straight-edged path through points [[x, y], ...], in the shape's space.
  path(shape, points, { closed = true, x = 0, y = 0, radius = 0, name } = {}) {
    const props = { x, y, isClosed: closed };
    if (name) props.name = name;
    const p = this.add('PointsPath', props, shape);
    for (const pt of points) {
      const r = pt[2] ?? radius;
      this.add('StraightVertex', { x: pt[0], y: pt[1], radius: r }, p);
    }
    return p;
  }

  fill(shape, c, { alpha = 1, visible = true } = {}) {
    const fill = this.add('Fill', { isVisible: visible, fillRule: 0 }, shape);
    const solid = this.add('SolidColor', { colorValue: color(c, alpha) }, fill);
    return { fill, color: solid };
  }

  stroke(shape, c, thickness = 2, { alpha = 1, cap = 1, join = 1, visible = true } = {}) {
    const stroke = this.add('Stroke', { isVisible: visible, thickness, cap, join, transformAffectsStroke: true }, shape);
    const solid = this.add('SolidColor', { colorValue: color(c, alpha) }, stroke);
    return { stroke, color: solid };
  }

  // A gradient fill. stops: [[position 0..1, colour], ...]; start/end in the shape's space.
  // kind 'radial' uses start as the centre and the distance to end as the radius.
  gradFill(shape, { kind = 'linear', start, end, stops, opacity = 1 }) {
    const fill = this.add('Fill', { isVisible: true, fillRule: 0 }, shape);
    const grad = this.gradient(fill, { kind, start, end, stops, opacity });
    return { fill, gradient: grad };
  }

  gradStroke(shape, thickness, { kind = 'linear', start, end, stops, opacity = 1 }, { cap = 1, join = 1 } = {}) {
    const stroke = this.add('Stroke', { isVisible: true, thickness, cap, join, transformAffectsStroke: true }, shape);
    const grad = this.gradient(stroke, { kind, start, end, stops, opacity });
    return { stroke, gradient: grad };
  }

  gradient(paint, { kind, start, end, stops, opacity }) {
    const grad = this.add(kind === 'radial' ? 'RadialGradient' : 'LinearGradient', {
      startX: start[0], startY: start[1], endX: end[0], endY: end[1], opacity,
    }, paint);
    grad.stops = stops.map(([position, c]) => this.add('GradientStop', { position, colorValue: color(c) }, grad));
    return grad;
  }

  // Softens a fill or stroke's edge (Rive "feather"): a cheap neon glow behind a sharp line.
  feather(paint, strength = 12, { inner = false } = {}) {
    return this.add('Feather', { strength, spaceValue: 0, offsetX: 0, offsetY: 0, inner }, paint.fill ?? paint.stroke ?? paint);
  }

  // Trim path on a stroke: draws only start..end of each contour (0..1). mode 1 = sequential.
  trim(stroke, { start = 0, end = 1, offset = 0, mode = 1 } = {}) {
    return this.add('TrimPath', { start, end, offset, modeValue: mode }, stroke.stroke ?? stroke);
  }

  interpolator(ease) {
    if (!ease) return null;
    const key = ease.join(',');
    if (!this.interpolators.has(key)) {
      this.interpolators.set(key, new Ref('CubicEaseInterpolator', { x1: ease[0], y1: ease[1], x2: ease[2], y2: ease[3] }));
    }
    return this.interpolators.get(key);
  }

  animation(name, { fps = 60, duration, loop = 0, speed = 1 } = {}) {
    const anim = new Animation(this, name, { fps, duration, loop, speed });
    anim.index = this.animations.length;
    this.animations.push(anim);
    return anim;
  }

  stateMachine(name) {
    const sm = new StateMachine(this, name);
    this.machines.push(sm);
    return sm;
  }

  write(out) {
    // Register every easing first: interpolators take artboard slots after the components.
    for (const anim of this.animations) {
      for (const props of anim.tracks.values()) {
        for (const { frames } of props) {
          for (const f of frames) if (f[2] !== 'hold') this.interpolator(f[2] === undefined ? EASE.out : f[2]);
        }
      }
    }
    // Rive draws the first drawable in the file on top. The builder is painter's order (added later
    // = on top), so sibling drawables are emitted in reverse; everything else keeps its order.
    // Indices are assigned in emission order, parents before children.
    const children = new Map();
    for (const ref of this.objects.slice(1)) {
      const parent = ref.props.parentId;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(ref);
    }
    const ordered = [];
    const emit = (ref) => {
      ordered.push(ref);
      const kids = children.get(ref) || [];
      const drawables = kids.filter((k) => DRAWABLE.has(k.cls));
      for (const k of kids) if (!DRAWABLE.has(k.cls)) emit(k);
      for (const k of drawables.reverse()) emit(k);
    };
    emit(this.self);
    ordered.forEach((ref, i) => { ref.index = i; });
    let idx = ordered.length;
    for (const ref of this.interpolators.values()) ref.index = idx++;
    for (const ref of ordered) out.object(ref);
    for (const ref of this.interpolators.values()) out.object(ref);
    for (const anim of this.animations) anim.write(out);
    for (const sm of this.machines) sm.write(out);
  }
}

// Which object class carries a keyable property, so the keyframe type can be chosen.
const KEYFRAME_CLASS = { double: 'KeyFrameDouble', color: 'KeyFrameColor', bool: 'KeyFrameBool' };

class Animation {
  constructor(artboard, name, { fps, duration, loop, speed }) {
    this.artboard = artboard;
    this.name = name;
    this.fps = fps;
    this.duration = duration;
    this.loop = loop;
    this.speed = speed;
    this.tracks = new Map(); // object ref -> [{prop, frames}]
  }

  // frames: [[frame, value, ease?], ...]. The ease applies from that keyframe to the next.
  // Times may be given in seconds with sec(), otherwise frames.
  key(target, prop, frames) {
    const ref = target.color ?? target; // allow passing a {fill, color} pair for colour keys
    const meta = lookup(ref.cls, prop);
    if (!KEYFRAME_CLASS[meta.type]) throw new Error(`Rive: cannot key ${prop} (${meta.type})`);
    if (!this.tracks.has(ref)) this.tracks.set(ref, []);
    this.tracks.get(ref).push({ prop, meta, frames });
    let last = 0;
    for (const f of frames) last = Math.max(last, f[0]);
    if (this.duration == null || this.duration < last) this.autoDuration = Math.max(this.autoDuration ?? 0, last);
    return this;
  }

  write(out) {
    const duration = this.duration ?? this.autoDuration ?? 60;
    out.raw('LinearAnimation', { name: this.name, fps: this.fps, duration, speed: this.speed, loopValue: this.loop });
    for (const [ref, props] of this.tracks) {
      out.raw('KeyedObject', { objectId: ref.index });
      for (const { meta, frames } of props) {
        out.raw('KeyedProperty', { propertyKey: meta.key });
        const sorted = [...frames].sort((a, b) => a[0] - b[0]);
        for (const [frame, value, ease] of sorted) {
          // interpolationType: 0 hold, 1 linear, 2 cubic. Default easing is EASE.out.
          const kf = { frame: Math.round(frame) };
          if (ease === 'hold') kf.interpolationType = 0;
          else {
            const interp = this.artboard.interpolator(ease === undefined ? EASE.out : ease);
            kf.interpolationType = interp ? 2 : 1;
            if (interp) kf.interpolatorId = interp;
          }
          kf.value = meta.type === 'color' ? color(value) : value;
          out.raw(KEYFRAME_CLASS[meta.type], kf);
        }
      }
    }
  }
}

class StateMachine {
  constructor(artboard, name) {
    this.artboard = artboard;
    this.name = name;
    this.inputs = [];
    this.layers = [];
  }
  input(cls, name, value) {
    const i = { cls, name, value, index: this.inputs.length };
    this.inputs.push(i);
    return i;
  }
  number(name, value = 0) { return this.input('StateMachineNumber', name, value); }
  bool(name, value = false) { return this.input('StateMachineBool', name, value); }
  trigger(name) { return this.input('StateMachineTrigger', name); }
  layer(name) {
    const l = new Layer(name);
    this.layers.push(l);
    return l;
  }
  write(out) {
    out.raw('StateMachine', { name: this.name });
    for (const i of this.inputs) {
      const props = { name: i.name };
      if (i.cls === 'StateMachineNumber') props.value = i.value;
      if (i.cls === 'StateMachineBool') props.value = i.value;
      out.raw(i.cls, props);
    }
    for (const l of this.layers) l.write(out);
  }
}

class Layer {
  constructor(name) {
    this.name = name;
    this.entry = { cls: 'EntryState', transitions: [], index: 0 };
    this.any = { cls: 'AnyState', transitions: [], index: 1 };
    this.exit = { cls: 'ExitState', transitions: [], index: 2 };
    this.states = [this.entry, this.any, this.exit];
  }
  state(animation, { speed = 1 } = {}) {
    const s = { cls: 'AnimationState', animation, speed, transitions: [], index: this.states.length };
    this.states.push(s);
    return s;
  }
  // conditions: [{ input, op: '>=' | '<' | '==' | '!=' | ..., value }] (trigger inputs take no op)
  transition(from, to, { conditions = [], duration = 0, exitTime = null, percent = false } = {}) {
    from.transitions.push({ to, conditions, duration, exitTime, percent });
    return this;
  }
  write(out) {
    out.raw('StateMachineLayer', { name: this.name });
    const OPS = { '==': 0, '!=': 1, '<=': 2, '>=': 3, '<': 4, '>': 5 };
    for (const s of this.states) {
      if (s.cls === 'AnimationState') out.raw('AnimationState', { animationId: s.animation.index, speed: s.speed });
      else out.raw(s.cls, {});
      for (const t of s.transitions) {
        // Rive's transition flags: 1 << 1 duration is a percentage, 1 << 2 exit time on,
        // 1 << 3 exit time is a percentage. `percent` is about the exit time ("after 100% of the
        // animation"); with 1 << 1 instead, an exit time of 100 meant 100 ms and states were cut short.
        let flags = 0;
        if (t.exitTime != null) flags |= 1 << 2;
        if (t.percent && t.exitTime != null) flags |= 1 << 3;
        const props = { stateToId: t.to.index, flags, duration: t.duration };
        if (t.exitTime != null) props.exitTime = t.exitTime;
        out.raw('StateTransition', props);
        for (const c of t.conditions) {
          const i = c.input;
          if (i.cls === 'StateMachineTrigger') out.raw('TransitionTriggerCondition', { inputId: i.index });
          else if (i.cls === 'StateMachineBool') out.raw('TransitionBoolCondition', { inputId: i.index, opValue: c.value === false ? 1 : 0 });
          else out.raw('TransitionNumberCondition', { inputId: i.index, opValue: OPS[c.op ?? '=='], value: c.value });
        }
      }
    }
  }
}

class Writer {
  constructor() {
    this.body = new Bytes();
    this.used = new Map(); // property key -> field type
  }
  raw(cls, props) {
    this.body.varuint(typeKeyOf(cls));
    for (const [name, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      const meta = lookup(cls, name);
      this.used.set(meta.key, meta.type);
      this.body.varuint(meta.key);
      const v = value instanceof Ref ? value.index : value;
      switch (meta.type) {
        case 'uint': case 'id': this.body.varuint(Math.round(v)); break;
        case 'bool': this.body.byte(v ? 1 : 0); break;
        case 'double': this.body.float32(v); break;
        case 'color': this.body.uint32(v); break;
        case 'string': this.body.string(String(v)); break;
        default: throw new Error(`Rive: unsupported field type ${meta.type} for ${cls}.${name}`);
      }
    }
    this.body.varuint(0);
  }
  object(ref) { this.raw(ref.cls, ref.props); }
}

export class RivFile {
  constructor() { this.artboards = []; }
  artboard(opts) {
    const a = new Artboard(this, opts);
    this.artboards.push(a);
    return a;
  }
  toBytes() {
    const w = new Writer();
    w.raw('Backboard', {});
    for (const a of this.artboards) a.write(w);

    const head = new Bytes();
    for (const ch of 'RIVE') head.byte(ch.charCodeAt(0));
    head.varuint(defs.majorVersion);
    head.varuint(0);
    head.varuint(0);
    const keys = [...w.used.keys()].sort((a, b) => a - b);
    for (const k of keys) head.varuint(k);
    head.varuint(0);
    // 2-bit field ids, 4 per uint32: uint/id/bool = 0, string = 1, double = 2, color = 3.
    const FIELD = { uint: 0, id: 0, bool: 0, string: 1, double: 2, color: 3 };
    for (let i = 0; i < keys.length; i += 4) {
      let word = 0;
      for (let j = 0; j < 4 && i + j < keys.length; j++) word |= FIELD[w.used.get(keys[i + j])] << (j * 2);
      head.uint32(word);
    }
    const a = head.toUint8Array();
    const b = w.body.toUint8Array();
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }
}

export const sec = (s, fps = 60) => Math.round(s * fps);
