import { describe, it, expect } from "vitest";
import {
  stripHtmlAndTruncate,
  decodeEntities,
  formatItalianDate,
  parseFullGasFeed,
  extractFeaturedImage,
} from "../fullGasFeed";

describe("fullGasFeed pure helpers", () => {
  it("stripHtmlAndTruncate strips tags and truncates at word boundary", () => {
    const out = stripHtmlAndTruncate(
      "<p>Lorem ipsum dolor sit amet consectetur.</p>",
      30,
    );
    expect(out).not.toMatch(/</);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(31);
    expect(out.startsWith("Lorem")).toBe(true);
  });

  it("stripHtmlAndTruncate does not add ellipsis when below threshold", () => {
    expect(stripHtmlAndTruncate("<p>breve</p>", 100)).toBe("breve");
  });

  it("decodeEntities decodes common HTML entities", () => {
    const out = decodeEntities("F1 &#124; GP &amp; Sprint &#8217;26");
    expect(out).toBe("F1 | GP & Sprint \u201926");
  });

  it("formatItalianDate produces an Italian-formatted date", () => {
    const d = new Date(2026, 4, 5); // 5 maggio 2026 (local)
    expect(formatItalianDate(d)).toBe("5 maggio 2026");
  });

  it("parseFullGasFeed parses a minimal RSS fixture", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Full Gas</title>
    <item>
      <title>GP &amp; Sprint</title>
      <link>https://fullgas.blog/a</link>
      <pubDate>Tue, 05 May 2026 14:08:28 +0000</pubDate>
      <description><![CDATA[<p>Primo articolo di test per il feed.</p>]]></description>
    </item>
    <item>
      <title>Secondo</title>
      <link>https://fullgas.blog/b</link>
      <pubDate>Mon, 04 May 2026 10:00:00 +0000</pubDate>
      <description>Solo testo</description>
    </item>
  </channel>
</rss>`;
    const result = parseFullGasFeed(xml);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].title).toBe("GP & Sprint");
    expect(result.items[0].link).toBe("https://fullgas.blog/a");
    expect(result.items[0].excerpt).toBe("Primo articolo di test per il feed.");
    expect(result.items[1].excerpt).toBe("Solo testo");
  });

  it("extractFeaturedImage picks ~480w variant from srcset", () => {
    const html =
      '<p>x</p><img src="https://x.test/full.webp" srcset="https://x.test/300.webp 300w, https://x.test/480.webp 480w, https://x.test/1024.webp 1024w" alt="x" />';
    expect(extractFeaturedImage(html)).toBe("https://x.test/480.webp");
  });

  it("extractFeaturedImage falls back to src and returns null when no img", () => {
    expect(extractFeaturedImage('<img src="https://x.test/a.jpg" />')).toBe(
      "https://x.test/a.jpg",
    );
    expect(extractFeaturedImage("<p>no image here</p>")).toBe(null);
  });
});
