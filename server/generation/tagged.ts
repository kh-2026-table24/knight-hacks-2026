// Claude answers with <notes>...</notes> then <room>/<house> JSON. These pull the pieces out.

/** Text of the last <tag>...</tag> block, or undefined if there is none. */
export function extractTagged(text: string, tag: string): string | undefined {
  return [...text.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].at(-1)?.[1].trim();
}

/** JSON inside the last <tag>...</tag> block, tolerating stray code fences. Throws if unreadable. */
export function extractTaggedJson(text: string, tag: string): unknown {
  const tagged = extractTagged(text, tag);
  if (tagged === undefined) throw new Error(`The response has no <${tag}>...</${tag}> block`);
  const body = tagged.replace(/```(?:json)?/g, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(`The <${tag}> block contains no JSON object`);
  return JSON.parse(body.slice(start, end + 1));
}
