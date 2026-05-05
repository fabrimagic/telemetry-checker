/**
 * Full Gas Blog RSS feed loader.
 * Fetches the F1 category feed, parses RSS 2.0 via DOMParser, and caches the
 * result in sessionStorage with a 30-minute TTL via clientCache helpers.
 */
import { readCache, writeCache } from "./clientCache";

export interface FullGasFeedItem {
  title: string;
  link: string;
  pubDate: Date;
  excerpt: string;
  /** URL of the article's featured image (small/medium variant), or null if unavailable. */
  imageUrl: string | null;
}

export interface FullGasFeedResult {
  items: FullGasFeedItem[];
  fetchedAt: Date;
}

interface SerializedItem {
  title: string;
  link: string;
  pubDateIso: string;
  excerpt: string;
  imageUrl: string | null;
}
interface SerializedResult {
  items: SerializedItem[];
  fetchedAtIso: string;
}

const FEED_URL = "https://fullgas.blog/category/formula1/feed/";
const CACHE_KEY = "fullgas:feed";
const CACHE_TTL_MS = 30 * 60 * 1000;
const EXCERPT_MAX_CHARS = 180;
const ITEMS_LIMIT = 3;

export async function fetchFullGasFeed(): Promise<FullGasFeedResult> {
  const cached = readCache<SerializedResult>(CACHE_KEY, CACHE_TTL_MS);
  if (cached) return deserialize(cached);

  const res = await fetch(FEED_URL, { method: "GET" });
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);
  const xmlText = await res.text();
  const parsed = parseFullGasFeed(xmlText);
  writeCache<SerializedResult>(CACHE_KEY, serialize(parsed));
  return parsed;
}

function serialize(r: FullGasFeedResult): SerializedResult {
  return {
    items: r.items.map((i) => ({
      title: i.title,
      link: i.link,
      pubDateIso: i.pubDate.toISOString(),
      excerpt: i.excerpt,
      imageUrl: i.imageUrl,
    })),
    fetchedAtIso: r.fetchedAt.toISOString(),
  };
}
function deserialize(s: SerializedResult): FullGasFeedResult {
  return {
    items: s.items.map((i) => ({
      title: i.title,
      link: i.link,
      pubDate: new Date(i.pubDateIso),
      excerpt: i.excerpt,
      imageUrl: i.imageUrl ?? null,
    })),
    fetchedAt: new Date(s.fetchedAtIso),
  };
}

export function parseFullGasFeed(xmlText: string): FullGasFeedResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Feed XML parse error");
  }
  const itemNodes = Array.from(doc.querySelectorAll("item")).slice(0, ITEMS_LIMIT);
  const items: FullGasFeedItem[] = itemNodes.map((node) => {
    const title = node.querySelector("title")?.textContent?.trim() ?? "";
    const link = node.querySelector("link")?.textContent?.trim() ?? "";
    const pubDateStr = node.querySelector("pubDate")?.textContent?.trim() ?? "";
    const descRaw = node.querySelector("description")?.textContent ?? "";
    // content:encoded carries the full post HTML which holds the <img> tags.
    // Fallback to description if encoded is empty.
    const encoded =
      node.getElementsByTagName("content:encoded")[0]?.textContent ?? "";
    return {
      title: decodeEntities(title),
      link,
      pubDate: pubDateStr ? new Date(pubDateStr) : new Date(0),
      excerpt: stripHtmlAndTruncate(descRaw, EXCERPT_MAX_CHARS),
      imageUrl: extractFeaturedImage(encoded || descRaw),
    };
  });
  return { items, fetchedAt: new Date() };
}

/**
 * Extract a thumbnail-sized featured image from an HTML blob.
 * Prefers a srcset variant ~480px wide for layout fit; falls back to the
 * src attribute. Returns null if no <img> is found.
 */
export function extractFeaturedImage(html: string): string | null {
  if (!html) return null;
  const imgMatch = html.match(/<img\b[^>]*>/i);
  if (!imgMatch) return null;
  const tag = imgMatch[0];
  const srcsetMatch = tag.match(/srcset=["']([^"']+)["']/i);
  if (srcsetMatch) {
    const candidates = srcsetMatch[1]
      .split(",")
      .map((c) => c.trim())
      .map((c) => {
        const parts = c.split(/\s+/);
        const url = parts[0];
        const wMatch = parts[1]?.match(/^(\d+)w$/);
        const width = wMatch ? Number(wMatch[1]) : 0;
        return { url, width };
      })
      .filter((c) => c.url && c.width > 0);
    if (candidates.length > 0) {
      // Pick the smallest width >= 400px, otherwise the largest available.
      const TARGET = 400;
      const okAbove = candidates
        .filter((c) => c.width >= TARGET)
        .sort((a, b) => a.width - b.width)[0];
      const fallback = candidates.sort((a, b) => b.width - a.width)[0];
      return (okAbove ?? fallback).url;
    }
  }
  const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
  return srcMatch ? srcMatch[1] : null;
}

export function stripHtmlAndTruncate(html: string, maxChars: number): string {
  const noTags = html.replace(/<[^>]*>/g, " ");
  const decoded = decodeEntities(noTags);
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  const truncated = collapsed.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(" ");
  const cut = lastSpace > maxChars * 0.6 ? truncated.slice(0, lastSpace) : truncated;
  return cut + "…";
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#124;/g, "|")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8220;/g, "\u201C")
    .replace(/&#8221;/g, "\u201D")
    .replace(/&#8211;/g, "\u2013")
    .replace(/&#8230;/g, "\u2026")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

export function formatItalianDate(d: Date): string {
  if (!d || isNaN(d.getTime())) return "";
  const months = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
