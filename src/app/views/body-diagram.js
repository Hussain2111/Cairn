// Front and back figures, with every muscle as a selectable region.
//
// The figures are built from rectangles and ellipses rather than traced
// anatomical outlines. That is a deliberate choice, not a shortcut: this has to
// communicate *which region is selected*, not teach anatomy. Accurate paths
// would be a large hand-authoring job, would carry a licensing question if
// taken from anywhere, and would be harder to keep legible at 180px in two
// themes. Blocks are honest about what they are.
//
// A muscle appears on the figure where you can actually see it. Lats, traps,
// rhomboids, glutes, hamstrings and calves are on the back; chest, abs, quads
// and the front delts are on the front. A region with no presence on a figure
// is simply absent from it rather than drawn greyed — the two figures together
// cover the body once, and drawing a placeholder for "the front of your lats"
// would be inventing anatomy to fill a gap.

import { el } from '../ui.js';
import { MUSCLES, MUSCLE_TAXONOMY, muscleGroup } from '../../core/schema.js';

const SVG = 'http://www.w3.org/2000/svg';

/** A rect with rounded corners, or an ellipse, in the figure's 100×220 space. */
const rect = (x, y, w, h, r = 3) => ({ shape: 'rect', x, y, w, h, r });
const ellipse = (cx, cy, rx, ry) => ({ shape: 'ellipse', cx, cy, rx, ry });

/**
 * The regions, per figure. Coordinates are in a 100 × 220 viewBox with the
 * figure centred on x = 50. Left and right sides of a paired muscle are one
 * region: you do not train one lat.
 */
export const FIGURES = {
  front: {
    label: 'Front',
    // The body outline, drawn under the regions so they read as parts of it.
    outline: [
      ellipse(50, 18, 11, 13),           // head
      rect(44, 30, 12, 8, 2),            // neck
      rect(30, 37, 40, 55, 6),           // torso
      rect(34, 90, 32, 34, 4),           // abdomen
      rect(18, 40, 12, 46, 5),           // left arm
      rect(70, 40, 12, 46, 5),           // right arm
      rect(20, 86, 10, 30, 4),           // left forearm
      rect(70, 86, 10, 30, 4),           // right forearm
      rect(33, 122, 15, 52, 5),          // left thigh
      rect(52, 122, 15, 52, 5),          // right thigh
      rect(35, 174, 12, 40, 4),          // left shin
      rect(53, 174, 12, 40, 4),          // right shin
    ],
    regions: {
      'front delts': [ellipse(28, 44, 8, 7), ellipse(72, 44, 8, 7)],
      'upper chest': [rect(32, 40, 36, 12, 4)],
      'mid chest': [rect(32, 53, 36, 13, 4)],
      'lower chest': [rect(34, 67, 32, 10, 4)],
      biceps: [rect(20, 55, 11, 22, 5), rect(69, 55, 11, 22, 5)],
      forearms: [rect(21, 88, 9, 26, 4), rect(70, 88, 9, 26, 4)],
      abs: [rect(40, 92, 20, 30, 4)],
      obliques: [rect(33, 92, 6, 28, 3), rect(61, 92, 6, 28, 3)],
      quads: [rect(34, 124, 13, 44, 5), rect(53, 124, 13, 44, 5)],
      adductors: [rect(46, 126, 8, 34, 3)],
      'side delts': [ellipse(24, 45, 6, 8), ellipse(76, 45, 6, 8)],
    },
  },
  back: {
    label: 'Back',
    outline: [
      ellipse(50, 18, 11, 13),
      rect(44, 30, 12, 8, 2),
      rect(30, 37, 40, 55, 6),
      rect(34, 90, 32, 34, 4),
      rect(18, 40, 12, 46, 5),
      rect(70, 40, 12, 46, 5),
      rect(20, 86, 10, 30, 4),
      rect(70, 86, 10, 30, 4),
      rect(33, 122, 15, 52, 5),
      rect(52, 122, 15, 52, 5),
      rect(35, 174, 12, 40, 4),
      rect(53, 174, 12, 40, 4),
    ],
    regions: {
      traps: [rect(38, 36, 24, 16, 4)],
      'rear delts': [ellipse(28, 46, 8, 7), ellipse(72, 46, 8, 7)],
      rhomboids: [rect(40, 52, 20, 14, 3)],
      lats: [rect(31, 53, 8, 30, 4), rect(61, 53, 8, 30, 4)],
      triceps: [rect(20, 55, 11, 22, 5), rect(69, 55, 11, 22, 5)],
      'lower back': [rect(38, 84, 24, 16, 3)],
      glutes: [rect(35, 102, 30, 20, 6)],
      hamstrings: [rect(34, 124, 13, 44, 5), rect(53, 124, 13, 44, 5)],
      calves: [rect(36, 178, 10, 30, 4), rect(54, 178, 10, 30, 4)],
    },
  },
};

/** Which figures a muscle appears on. Every muscle appears on at least one. */
export function figuresFor(muscle) {
  return Object.entries(FIGURES)
    .filter(([, figure]) => figure.regions[muscle])
    .map(([key]) => key);
}

/** Sanity: no muscle in the taxonomy is missing from both figures. */
export const UNDRAWN_MUSCLES = MUSCLES.filter((m) => figuresFor(m).length === 0);

function svgNode(spec) {
  if (spec.shape === 'ellipse') {
    const node = document.createElementNS(SVG, 'ellipse');
    node.setAttribute('cx', spec.cx);
    node.setAttribute('cy', spec.cy);
    node.setAttribute('rx', spec.rx);
    node.setAttribute('ry', spec.ry);
    return node;
  }
  const node = document.createElementNS(SVG, 'rect');
  node.setAttribute('x', spec.x);
  node.setAttribute('y', spec.y);
  node.setAttribute('width', spec.w);
  node.setAttribute('height', spec.h);
  node.setAttribute('rx', spec.r);
  return node;
}

/**
 * One figure.
 *
 * Each region is a `<g role="button">` with a tabindex, so it is reachable and
 * activatable from the keyboard: a picker you can only use with a mouse is not
 * a picker, it is a decoration next to one.
 */
function figure(which, { selected, onSelect }) {
  const spec = FIGURES[which];
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 100 220');
  svg.setAttribute('class', 'figure__svg');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', `${spec.label} of the body`);

  const outline = document.createElementNS(SVG, 'g');
  outline.setAttribute('class', 'figure__outline');
  for (const shape of spec.outline) outline.appendChild(svgNode(shape));
  svg.appendChild(outline);

  for (const [muscle, shapes] of Object.entries(spec.regions)) {
    const group = document.createElementNS(SVG, 'g');
    group.setAttribute('class', 'region');
    group.setAttribute('data-muscle', muscle);
    group.setAttribute('data-group', muscleGroup(muscle));
    group.setAttribute('data-selected', String(selected === muscle));
    group.setAttribute('role', 'button');
    group.setAttribute('tabindex', '0');
    group.setAttribute('aria-pressed', String(selected === muscle));
    group.setAttribute('aria-label', muscle);

    const title = document.createElementNS(SVG, 'title');
    title.textContent = muscle;
    group.appendChild(title);
    for (const shape of shapes) group.appendChild(svgNode(shape));

    group.addEventListener('click', () => onSelect(muscle));
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(muscle);
      }
    });
    svg.appendChild(group);
  }

  return el('div.figure', [svg, el('div.figure__label', { text: spec.label })]);
}

/**
 * Both figures, side by side, as one control.
 *
 * The diagram and the muscle list are two views of one selection, so this
 * returns a node with a `select(muscle)` method rather than owning the state:
 * whichever view the click came from, both update.
 */
export function bodyDiagram({ selected = null, onSelect = () => {} } = {}) {
  let current = selected;

  const host = el('div.figures', { role: 'group', 'aria-label': 'Muscle groups on the body' });

  /**
   * Reflect the selection without rebuilding the SVG.
   *
   * Rebuilding would drop the focus ring on the region that was just
   * activated, so a keyboard user would press Enter and lose their place —
   * which makes a second press impossible without tabbing back. Setting two
   * attributes leaves focus exactly where it was.
   */
  const paint = () => {
    for (const node of host.querySelectorAll('.region')) {
      const on = node.dataset.muscle === current;
      node.setAttribute('data-selected', String(on));
      node.setAttribute('aria-pressed', String(on));
    }
  };

  function choose(muscle) {
    current = current === muscle ? null : muscle;
    paint();
    onSelect(current);
  }

  host.select = (muscle) => {
    if (current === muscle) return;
    current = muscle;
    paint();
  };

  host.replaceChildren(
    figure('front', { selected: current, onSelect: choose }),
    figure('back', { selected: current, onSelect: choose }),
  );
  return host;
}

/** The muscle list that pairs with the diagram, grouped and keyboard-reachable. */
export function muscleList({ selected = null, onSelect = () => {} } = {}) {
  const host = el('div.muscle-list');

  for (const [group, muscles] of Object.entries(MUSCLE_TAXONOMY)) {
    host.appendChild(el('div.muscle-list__group', [
      el('span.muscle-list__heading', { text: group }),
      el('div.muscle-list__items', muscles.map((muscle) =>
        el('button.muscle-chip', {
          type: 'button',
          text: muscle,
          dataset: { muscle },
          'aria-pressed': String(selected === muscle),
          onclick: () => onSelect(muscle),
        }))),
    ]));
  }

  host.select = (muscle) => {
    for (const node of host.querySelectorAll('.muscle-chip')) {
      node.setAttribute('aria-pressed', String(node.dataset.muscle === muscle));
    }
  };
  return host;
}

/**
 * Diagram plus list, wired to each other. Selecting in either updates both,
 * which is the whole point: they are two views of one selection.
 */
export function musclePicker({ selected = null, onChange = () => {} } = {}) {
  let current = selected;

  const diagram = bodyDiagram({
    selected: current,
    onSelect: (muscle) => {
      current = muscle;
      list.select(muscle);
      onChange(muscle);
    },
  });

  const list = muscleList({
    selected: current,
    onSelect: (muscle) => {
      current = current === muscle ? null : muscle;
      diagram.select(current);
      list.select(current);
      onChange(current);
    },
  });

  const host = el('div.muscle-picker', [diagram, list]);
  host.value = () => current;
  return host;
}
