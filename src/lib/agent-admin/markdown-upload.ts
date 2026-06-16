export function slugFromText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export function parseMarkdownMetadata(text: string, fallbackName: string) {
  const fallback = fallbackName.replace(/\.md$/i, "");
  const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const meta: Record<string, string> = {};
  if (frontmatter) {
    const lines = frontmatter[1].split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const rawValue = line.slice(idx + 1).trim();
      if (rawValue === ">" || rawValue === "|") {
        const block: string[] = [];
        while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
          index += 1;
          block.push(lines[index].trim());
        }
        meta[key] = block.join(" ");
      } else {
        meta[key] = rawValue.replace(/^['"]|['"]$/g, "");
      }
    }
  }
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const name = meta.name || heading || fallback;
  return {
    id: slugFromText(name || fallback) || "uploaded-md",
    name,
    description: meta.description || "",
    schedule: meta.schedule || "",
  };
}
