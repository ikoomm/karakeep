import { Readability } from "@mozilla/readability";
import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { sanitizeReadableContent } from "./readerMath";

function inspect(html: string, check: (document: Document) => void) {
  const dom = new JSDOM(sanitizeReadableContent(html));
  try {
    check(dom.window.document);
  } finally {
    dom.window.close();
  }
}

describe("reader math", () => {
  it("renders the reported Distill formula after Readability extraction", () => {
    // https://github.com/karakeep-app/karakeep/issues/1243
    const html = String.raw`<html><head><title>Encoder notes</title></head><body><article>
      <p>We examine the encoder matrix and its relationship to the layer index.
      This paragraph provides enough surrounding article content for extraction.
      The reader should preserve the explanation and render the inline notation.</p>
      <p>where <d-math>W_{enc}^{\ell}</d-math> is the CLT encoder matrix at layer <d-math>\ell</d-math>.</p>
      </article></body></html>`;
    const dom = new JSDOM(html);
    try {
      const readable = new Readability(dom.window.document).parse();
      expect(readable?.content).toContain("d-math");
      inspect(readable!.content!, (document) => {
        expect(document.querySelectorAll("math")).toHaveLength(2);
        expect(document.querySelector("msubsup > mi")?.textContent).toBe("W");
        expect(document.querySelector("msubsup")?.textContent).toBe("Wencℓ");
        expect(
          document.querySelector("d-math, script, .katex-html"),
        ).toBeNull();
        expect(
          document.querySelector("math")?.getAttribute("display"),
        ).toBeNull();
      });
    } finally {
      dom.window.close();
    }
  });

  it("preserves block layout and equation structure", () => {
    inspect(String.raw`<d-math block>\frac{x^2}{y}</d-math>`, (document) => {
      expect(document.querySelector("math")?.getAttribute("display")).toBe(
        "block",
      );
      expect(document.querySelector("mfrac > msup")?.textContent).toBe("x2");
      expect(document.querySelector("mfrac > mi")?.textContent).toBe("y");
    });
  });

  it("handles HTML entities and uppercase custom tags", () => {
    inspect("<D-MATH>x &lt; y</D-MATH>", (document) => {
      expect(document.querySelector("math mo")?.textContent).toBe("<");
      expect(document.querySelectorAll("math")).toHaveLength(1);
    });
  });

  it("keeps one MathML representation in already-rendered captures", () => {
    inspect(
      `<d-math block><span class="katex"><span class="katex-mathml">
      <math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mi>x</mi></math>
      </span><span class="katex-html" aria-hidden="true">duplicate x</span></span></d-math>`,
      (document) => {
        expect(document.querySelectorAll("math")).toHaveLength(1);
        expect(document.body.textContent).toBe("x");
        expect(document.querySelector("math")?.getAttribute("display")).toBe(
          "block",
        );
        expect(document.querySelector(".katex-html")).toBeNull();
      },
    );
  });

  it("leaves ordinary HTML and existing native MathML on the sanitizer path", () => {
    const html =
      "<p>Price $5 and $10; literal \\(x\\).</p><math><mi>Q</mi></math>";
    const dom = new JSDOM("");
    try {
      expect(sanitizeReadableContent(html)).toBe(
        DOMPurify(dom.window).sanitize(html),
      );
    } finally {
      dom.window.close();
    }
  });

  it("does not interpret code examples", () => {
    inspect(
      String.raw`<pre><d-math>x^2</d-math></pre><code><d-math>\ell</d-math></code>`,
      (document) => {
        expect(document.querySelector("math")).toBeNull();
        expect(document.querySelector("pre")?.textContent).toBe("x^2");
        expect(document.querySelector("code")?.textContent).toBe(
          String.raw`\ell`,
        );
      },
    );
  });

  it.each([
    String.raw`\unknowncommand{x}`,
    String.raw`\frac{`,
    String.raw`\def\a{\a}\a`,
  ])("keeps unsupported or unbounded source readable: %s", (source) => {
    inspect(
      `<p>Before</p><d-math>${source}</d-math><p>After</p>`,
      (document) => {
        expect(document.querySelector("math")).toBeNull();
        expect(document.body.textContent).toBe(`Before${source}After`);
      },
    );
  });

  it("preserves empty and over-limit formulas without evaluating them", () => {
    const source = "x".repeat(10_001);
    inspect(
      `<p>Before</p><d-math> </d-math><d-math>${source}</d-math>`,
      (document) => {
        expect(document.querySelector("math")).toBeNull();
        expect(document.body.textContent).toBe(`Before ${source}`);
      },
    );
  });

  it("sanitizes both rendered content and surrounding HTML", () => {
    inspect(
      String.raw`<p onclick="alert(1)">Before</p><script>alert(1)</script>
      <d-math>\href{javascript:alert(1)}{x}</d-math>
      <d-math><math><mi onclick="alert(1)">y</mi></math></d-math>`,
      (document) => {
        expect(document.querySelector("script, [onclick], [href]")).toBeNull();
        expect(document.body.textContent).toContain("Before");
        expect(document.querySelector("math mi")?.textContent).toBe("y");
      },
    );
  });

  it("is stable when cached content is processed again", () => {
    const once = sanitizeReadableContent(
      String.raw`<p>Before <d-math>W_{enc}^{\ell}</d-math> after.</p>`,
    );
    expect(sanitizeReadableContent(once)).toBe(once);
    const first = new JSDOM(once);
    const second = new JSDOM(sanitizeReadableContent(once));
    try {
      // Text-node offsets are identical after a reload; no client renderer
      // inserts a second visual representation after highlights are applied.
      function texts(document: Document) {
        const walker = document.createTreeWalker(document.body, 4);
        const result: string[] = [];
        while (walker.nextNode())
          result.push(walker.currentNode.textContent ?? "");
        return result;
      }
      expect(texts(second.window.document)).toEqual(
        texts(first.window.document),
      );
    } finally {
      first.window.close();
      second.window.close();
    }
  });
});
