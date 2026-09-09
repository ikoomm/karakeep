import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { renderToString } from "katex";

export function sanitizeReadableContent(html: string): string {
  const window = new JSDOM("").window;
  try {
    const purify = DOMPurify(window);
    if (!/<d-math[\s>]/i.test(html)) {
      return purify.sanitize(html);
    }
    const template = window.document.createElement("template");
    template.innerHTML = html;
    renderReaderMath(template.content);
    return purify.sanitize(template.innerHTML);
  } finally {
    window.close();
  }
}

/**
 * Distill's custom element normally needs page JavaScript and KaTeX CSS.
 * Resolve it before sanitization removes the element, using native MathML so
 * cached reader content needs neither scripts nor a client-side DOM rewrite.
 */
export function renderReaderMath(root: ParentNode): void {
  for (const element of root.querySelectorAll("d-math")) {
    if (element.closest("pre, code, math")) {
      continue;
    }

    // A browser/SingleFile capture may already contain both KaTeX's MathML and
    // its CSS-dependent HTML fallback. Keep only the native representation.
    const existingMath = element.querySelector("math");
    if (existingMath) {
      element.replaceWith(existingMath.cloneNode(true));
      continue;
    }

    const source = element.textContent ?? "";
    if (!source.trim() || source.length > 10_000) {
      continue;
    }

    try {
      const template = element.ownerDocument.createElement("template");
      template.innerHTML = renderToString(source, {
        output: "mathml",
        displayMode: element.hasAttribute("block"),
        throwOnError: true,
        trust: false,
        maxExpand: 1_000,
        maxSize: 20,
      });
      const math = template.content.querySelector("math");
      if (math) {
        element.replaceWith(math);
      }
    } catch {
      // Unsupported TeX must not discard the article or the original formula.
      // Leave it for the normal sanitizer, which retains the text content.
    }
  }
}
