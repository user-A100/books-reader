import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { WeReadSourceConfig } from "../../models/WeRead";

const CONFIG_KEY = "weread";
const CONFIG_NAMESPACE = "onlineLibrarySources";

const EMPTY_CONFIG: WeReadSourceConfig = {
  id: "weread",
  name: "微信读书",
  baseUrl: "https://i.weread.qq.com",
  description: "微信读书 API 搜索源（仅使用你自己的授权参数）",
  enabled: true,
  vid: "",
  accessToken: "",
  userAgent: "",
  loginMode: "qr",
};

export const getWeReadConfig = (): WeReadSourceConfig => {
  try {
    const stored = ConfigService.getObjectConfig(
      CONFIG_KEY,
      CONFIG_NAMESPACE,
      null
    ) as Partial<WeReadSourceConfig> | null;
    return {
      ...EMPTY_CONFIG,
      ...(stored || {}),
      id: "weread",
      baseUrl: "https://i.weread.qq.com",
    };
  } catch {
    return { ...EMPTY_CONFIG };
  }
};

export const saveWeReadConfig = (
  config: Partial<WeReadSourceConfig>
): WeReadSourceConfig => {
  const next = {
    ...getWeReadConfig(),
    ...config,
    id: "weread" as const,
    baseUrl: "https://i.weread.qq.com",
  };
  ConfigService.setObjectConfig(CONFIG_KEY, next, CONFIG_NAMESPACE);
  return next;
};

export const hasWeReadCredentials = (config = getWeReadConfig()): boolean =>
  Boolean(config.vid.trim() && config.accessToken.trim() && config.userAgent.trim());
