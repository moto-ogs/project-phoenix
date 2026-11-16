// Motion in the stylesheets stays on the compositor (frontend-ui-kit.md,
// "Motion"). The oxlint rule `ui-kit/no-costly-motion` guards class strings
// and style objects; this test guards src/**/*.css, where every @keyframes
// lives.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const SRC = new URL("../src/", import.meta.url).pathname;

// Properties a keyframe may change. stroke-dashoffset draws the small
// sidebar icons (nav-scenes.css): paint on a 20-px SVG, no layout.
const KEYFRAME_PROPERTIES = new Set([
  "opacity",
  "transform",
  "translate",
  "scale",
  "rotate",
  "stroke-dashoffset",
]);

// Same list as LAYOUT_PROPERTY_RE in oxlint-plugin-ui-kit.mjs.
const LAYOUT_PROPERTY_RE =
  /^(?:width|height|min-width|min-height|max-width|max-height|top|right|bottom|left|inset(?:-[\w-]+)?|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|gap|row-gap|column-gap|flex-basis|grid-template-columns|font-size|line-height|border(?:-[\w-]+)?-width)$/;

function cssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

function withoutComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The body of every @keyframes block, with its name. */
function keyframeBlocks(css) {
  const blocks = [];
  const start = /@keyframes\s+([\w-]+)\s*\{/g;
  for (const match of css.matchAll(start)) {
    let depth = 1;
    let index = match.index + match[0].length;
    const bodyStart = index;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push({ name: match[1], body: css.slice(bodyStart, index - 1) });
  }
  return blocks;
}

// The two blurs the kit allows, each written once (frontend-ui-kit.md,
// Motion): the overlay blur behind dialogs and side panels, and the glass of
// small resting chips.
const BLUR_RULE_RE = /^\.moto-(?:overlay-blur|glass)$/;

/** Problems in one stylesheet's text. */
function motionProblems(css) {
  const text = withoutComments(css);
  const problems = [];

  for (const { name, body } of keyframeBlocks(text)) {
    for (const [, property] of body.matchAll(/([\w-]+)\s*:/g)) {
      if (!KEYFRAME_PROPERTIES.has(property)) {
        problems.push(`@keyframes ${name} animates ${property}`);
      }
    }
  }

  // Innermost rules only: a keyframe step is checked above.
  const outsideKeyframes = keyframeBlocks(text).reduce(
    (rest, { body }) => rest.replace(body, ""),
    text,
  );
  for (const [, selector, body] of outsideKeyframes.matchAll(
    /([^{};]+)\{([^{}]*)\}/g,
  )) {
    // By hand only unprefixed: lightningcss merges a hand-written pair into
    // `-webkit-backdrop-filter` alone in the production build, and Chrome
    // ignores that (staging showed no blur after #7274).
    if (/(?:^|[;\s])-webkit-backdrop-filter\s*:/.test(body)) {
      problems.push("-webkit-backdrop-filter by hand");
    }
    if (BLUR_RULE_RE.test(selector.trim())) continue;
    for (const [, property, value] of body.matchAll(
      /(?:^|[;\s])((?:-webkit-)?backdrop-filter)\s*:\s*([^;}]+)/g,
    )) {
      if (value.trim() !== "none") {
        problems.push(`${property}: ${value.trim()}`);
      }
    }
  }

  for (const [, value] of text.matchAll(
    /(?:^|[;{\s])transition(?:-property)?\s*:\s*([^;}]+)/g,
  )) {
    for (const token of value.split(/[\s,]+/)) {
      if (token === "all" || LAYOUT_PROPERTY_RE.test(token)) {
        problems.push(`transition of ${token}`);
      }
    }
  }

  for (const [, utilities] of text.matchAll(/@apply\s+([^;]+)/g)) {
    for (const utility of utilities.split(/\s+/)) {
      const name = utility.slice(utility.lastIndexOf(":") + 1);
      const list = /^transition-\[(.*)\]$/.exec(name)?.[1];
      if (
        name === "transition-all" ||
        name.startsWith("backdrop-") ||
        (list !== undefined &&
          list.split(/[,_]+/).some((token) => LAYOUT_PROPERTY_RE.test(token)))
      ) {
        problems.push(`@apply ${utility}`);
      }
    }
  }
  return problems;
}

test("stylesheets animate only compositor properties", () => {
  const files = cssFiles(SRC);
  assert.ok(files.length > 0, "no stylesheet found under src/");
  const problems = files.flatMap((file) =>
    motionProblems(readFileSync(file, "utf8")).map(
      (problem) => `${relative(SRC, file)}: ${problem}`,
    ),
  );
  assert.deepEqual(problems, []);
});

test("the check finds each kind of costly motion", () => {
  assert.deepEqual(
    motionProblems(`
      @keyframes grow { from { width: 0; } to { width: 100%; } }
      @keyframes slide { from { transform: translateX(-100%); opacity: 0 } to { transform: none } }
      .glass { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
      .moto-glass { backdrop-filter: blur(8px); }
      .moto-overlay-blur { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
      @keyframes other-blur { to { backdrop-filter: blur(8px); } }
      .print { backdrop-filter: none; }
      .a { transition: all 200ms; }
      .b { transition: height 200ms ease, opacity 200ms; }
      .c { transition-property: color, box-shadow; }
      .d { @apply transition-[width] md:backdrop-blur-sm transition-[opacity,transform]; }
      /* @keyframes inComment { from { left: 0 } } */
    `),
    [
      "@keyframes grow animates width",
      "@keyframes grow animates width",
      "@keyframes other-blur animates backdrop-filter",
      "-webkit-backdrop-filter by hand",
      "backdrop-filter: blur(8px)",
      "-webkit-backdrop-filter: blur(8px)",
      "-webkit-backdrop-filter by hand",
      "transition of all",
      "transition of height",
      "@apply transition-[width]",
      "@apply md:backdrop-blur-sm",
    ],
  );
});
