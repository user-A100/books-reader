import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { LegadoProgress, LegadoServerConfig } from "../../models/Legado";

const CONFIG_KEY = "servers";
const CONFIG_NAMESPACE = "legado";
const PROGRESS_NAMESPACE = "legadoProgress";
const CONTENT_NAMESPACE = "legadoContent";

export const getLegadoServers = (): LegadoServerConfig[] => {
  try {
    const value = ConfigService.getObjectConfig(
      CONFIG_KEY,
      CONFIG_NAMESPACE,
      null
    );
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

export const saveLegadoServers = (
  servers: LegadoServerConfig[]
): LegadoServerConfig[] => {
  ConfigService.setObjectConfig(CONFIG_KEY, servers, CONFIG_NAMESPACE);
  return servers;
};

const progressKey = (serverId: string, bookUrl: string): string =>
  `${serverId}:${bookUrl}`;

export const getLocalLegadoProgress = (
  serverId: string,
  bookUrl: string
): LegadoProgress | null => {
  try {
    return ConfigService.getObjectConfig(
      progressKey(serverId, bookUrl),
      PROGRESS_NAMESPACE,
      null
    ) as LegadoProgress | null;
  } catch {
    return null;
  }
};

export const saveLocalLegadoProgress = (
  serverId: string,
  bookUrl: string,
  progress: LegadoProgress
): void => {
  ConfigService.setObjectConfig(
    progressKey(serverId, bookUrl),
    progress,
    PROGRESS_NAMESPACE
  );
};

export const getCachedLegadoContent = (
  serverId: string,
  bookUrl: string,
  chapterIndex: number
): string => {
  try {
    return String(ConfigService.getObjectConfig(
      `${serverId}:${bookUrl}:${chapterIndex}`,
      CONTENT_NAMESPACE,
      ""
    ) || "");
  } catch {
    return "";
  }
};

export const saveCachedLegadoContent = (
  serverId: string,
  bookUrl: string,
  chapterIndex: number,
  content: string
): void => {
  ConfigService.setObjectConfig(
    `${serverId}:${bookUrl}:${chapterIndex}`,
    content,
    CONTENT_NAMESPACE
  );
};
