import { isElectron } from "react-device-detect";
import { isPrivateHostname } from "../bookSource/sourceEngine";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

const validateUrl = (value: string): URL => {
  const url = new URL(value.trim());
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    isPrivateHostname(url.hostname)
  ) {
    throw new Error("Only public HTTP or HTTPS URLs are supported");
  }
  return url;
};

const decodeBase64 = (value: string): string => {
  const binary = atob(value);
  if (binary.length > MAX_SOURCE_BYTES) throw new Error("Book source file exceeds 10 MB");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder("utf-8").decode(bytes);
};

export const fetchLegadoSourceJson = async (value: string): Promise<string> => {
  const url = validateUrl(value);
  if (isElectron && (window as any).require) {
    const result = await window
      .require("electron")
      .ipcRenderer.invoke("plugin-http-fetch", {
        url: url.toString(),
        method: "GET",
        headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.1" },
      });
    if (!result || result.status < 200 || result.status >= 300) {
      throw new Error(`HTTP ${result?.status || 500}`);
    }
    return result.binary ? decodeBase64(String(result.body || "")) : String(result.body || "");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_SOURCE_BYTES) throw new Error("Book source file exceeds 10 MB");
    return new TextDecoder("utf-8").decode(buffer);
  } finally {
    clearTimeout(timer);
  }
};
