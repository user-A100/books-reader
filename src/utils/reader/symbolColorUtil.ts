export interface SymbolColorRule {
  id: string;
  start: string;
  end: string;
  color: string;
  enabled: boolean;
}

interface ColorInterval {
  start: number;
  end: number;
  rule: SymbolColorRule;
}

const DEFAULT_SYMBOL_COLOR_RULES: SymbolColorRule[] = [
  {
    id: "curly-quotes",
    start: "“",
    end: "”",
    color: "#86bf8f",
    enabled: true,
  },
  {
    id: "double-quotes",
    start: '"',
    end: '"',
    color: "#86bf8f",
    enabled: true,
  },
  {
    id: "book-title",
    start: "《",
    end: "》",
    color: "#73aee6",
    enabled: true,
  },
];

const EXCLUDED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "OPTION",
]);

export const getDefaultSymbolColorRules = (): SymbolColorRule[] =>
  DEFAULT_SYMBOL_COLOR_RULES.map((rule) => ({ ...rule }));

export const parseSymbolColorRules = (value?: string): SymbolColorRule[] => {
  if (!value) return getDefaultSymbolColorRules();

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return getDefaultSymbolColorRules();

    return parsed
      .filter(
        (rule) =>
          rule &&
          typeof rule.id === "string" &&
          typeof rule.start === "string" &&
          typeof rule.end === "string" &&
          typeof rule.color === "string" &&
          typeof rule.enabled === "boolean" &&
          rule.start.length > 0 &&
          rule.end.length > 0
      )
      .slice(0, 20)
      .map((rule) => ({
        id: rule.id,
        start: rule.start.slice(0, 12),
        end: rule.end.slice(0, 12),
        color: rule.color,
        enabled: rule.enabled,
      }));
  } catch {
    return getDefaultSymbolColorRules();
  }
};

const unwrapSymbolSpans = (doc: Document) => {
  doc.querySelectorAll("span[data-koodo-symbol-color]").forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  });
};

const collectIntervals = (
  text: string,
  rules: SymbolColorRule[]
): ColorInterval[] => {
  const activeRules = rules
    .filter((rule) => rule.enabled && rule.start && rule.end)
    .sort((left, right) => right.start.length - left.start.length);
  const intervals: ColorInterval[] = [];
  const stack: Array<{ rule: SymbolColorRule; contentStart: number }> = [];

  for (let index = 0; index < text.length; ) {
    const openRule = stack[stack.length - 1];
    if (openRule && text.startsWith(openRule.rule.end, index)) {
      if (openRule.contentStart < index) {
        intervals.push({
          start: openRule.contentStart,
          end: index,
          rule: openRule.rule,
        });
      }
      stack.pop();
      index += openRule.rule.end.length;
      continue;
    }

    const rule = activeRules.find((item) => text.startsWith(item.start, index));
    if (rule) {
      stack.push({ rule, contentStart: index + rule.start.length });
      index += rule.start.length;
      continue;
    }
    index += 1;
  }

  return intervals;
};

const getCoveringRule = (
  intervals: ColorInterval[],
  start: number,
  end: number
) =>
  intervals
    .filter((interval) => interval.start <= start && interval.end >= end)
    .sort((left, right) => right.start - left.start || left.end - right.end)[0]
    ?.rule;

/**
 * Wraps text between paired symbols without rewriting the book's HTML. The
 * document-wide text map lets a rule continue across inline tags and paragraphs.
 */
export const applySymbolColoring = (
  doc: Document,
  rules: SymbolColorRule[]
) => {
  unwrapSymbolSpans(doc);
  if (!doc.body || rules.length === 0) return;

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || EXCLUDED_TAGS.has(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const textNodes: Array<{ node: Text; start: number; end: number }> = [];
  let text = "";
  let node = walker.nextNode();
  while (node) {
    const value = node.textContent || "";
    const start = text.length;
    text += value;
    textNodes.push({ node: node as Text, start, end: text.length });
    node = walker.nextNode();
  }

  const intervals = collectIntervals(text, rules);
  if (intervals.length === 0) return;

  textNodes.forEach(({ node: textNode, start: nodeStart, end: nodeEnd }) => {
    const boundaries = new Set<number>([nodeStart, nodeEnd]);
    intervals.forEach((interval) => {
      if (interval.end <= nodeStart || interval.start >= nodeEnd) return;
      boundaries.add(Math.max(nodeStart, interval.start));
      boundaries.add(Math.min(nodeEnd, interval.end));
    });
    const points = Array.from(boundaries).sort((left, right) => left - right);
    const isColored = intervals.some(
      (interval) => interval.start < nodeEnd && interval.end > nodeStart
    );
    if (!isColored) return;

    const fragment = doc.createDocumentFragment();
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      const value = text.slice(start, end);
      const rule = getCoveringRule(intervals, start, end);
      if (!rule) {
        fragment.appendChild(doc.createTextNode(value));
        continue;
      }
      const span = doc.createElement("span");
      span.dataset.koodoSymbolColor = rule.id;
      // Reader themes intentionally use !important for the global text color.
      // Symbol rules are a more specific user choice and must win that cascade.
      span.style.setProperty("color", rule.color, "important");
      span.textContent = value;
      fragment.appendChild(span);
    }
    textNode.parentNode?.replaceChild(fragment, textNode);
  });
};
