function ipv4ToInt(ip: string) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    out = ((out << 8) + value) >>> 0;
  }
  return out;
}

function inCidr(ip: string, cidr: string) {
  if (!cidr.includes("/")) return ip === cidr;

  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  if (bits === 0) return true;
  const mask = (~((2 ** (32 - bits)) - 1)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function ipAllowed(ip: string, allowlist: string) {
  if (!ip) return false;
  return allowlist
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .some((item) => inCidr(ip, item));
}

export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
}
