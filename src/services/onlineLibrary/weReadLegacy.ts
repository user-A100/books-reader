import { WeReadSourceConfig } from "../../models/WeRead";

export const parseWeReadLegacySource = (
  text: string
): WeReadSourceConfig | null => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const candidates = Array.isArray(value) ? value : [value];
  const source = candidates.find(
    (candidate): candidate is Record<string, unknown> =>
      !!candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).bookSourceUrl ===
        "https://i.weread.qq.com"
  );
  if (!source) return null;
  if (source.bookSourceUrl !== "https://i.weread.qq.com") return null;
  if (!source.ruleSearch || typeof source.ruleSearch !== "object") return null;

  return {
    id: "weread",
    name:
      typeof source.bookSourceName === "string" && source.bookSourceName.trim()
        ? source.bookSourceName.trim()
        : "微信读书",
    baseUrl: "https://i.weread.qq.com",
    description:
      "已导入微信读书书源规则。Koodo 不执行原书源脚本，也不解密受保护章节。",
    enabled: source.enabled !== false,
    vid: "",
    accessToken: "",
    userAgent: "",
  };
};
