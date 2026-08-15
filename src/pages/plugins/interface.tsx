import { RouteComponentProps } from "react-router-dom";
import { CommunityPluginEntry } from "../../models/Plugin";
import { InstalledPluginRecord } from "../../services/plugins/pluginTypes";

export interface PluginsProps extends RouteComponentProps {
  t: (key: string, options?: Record<string, unknown>) => string;
}

export interface PluginsState {
  records: InstalledPluginRecord[];
  community: CommunityPluginEntry[] | null;
  loadingCommunity: boolean;
  /** Plugin id with an operation in flight (drives button spinners). */
  busyId: string | null;
  selectedId: string | null;
  query: string;
}
