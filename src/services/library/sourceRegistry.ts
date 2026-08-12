import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import {
  LibrarySourceDescriptor,
  LibrarySourceKind,
} from "../../models/LibrarySource";
import { getBookSources } from "../bookSource/sourceStorage";
import { getWeReadConfig } from "../onlineLibrary/weReadStorage";

interface StoredOPDSCatalog {
  id: string;
  title: string;
  url: string;
}

const OPDS_CATALOGS_KEY = "opdsCatalogs";
const OPDS_CATALOG_LIST_KEY = "opdsCatalogList";

const createDescriptor = (
  id: string,
  name: string,
  kind: LibrarySourceKind,
  description: string,
  configured = true
): LibrarySourceDescriptor => ({
  id,
  name,
  kind,
  description,
  configured,
  capabilities:
    kind === "web" ? ["search", "read-online"] : ["search", "download"],
});

export const getOPDSCatalogSources = (): LibrarySourceDescriptor[] => {
  try {
    const catalogs = (ConfigService.getAllObjectConfig(OPDS_CATALOGS_KEY) ||
      {}) as Record<string, StoredOPDSCatalog>;
    const ids = (ConfigService.getAllListConfig(OPDS_CATALOG_LIST_KEY) ||
      []) as string[];
    return ids
      .map((id) => catalogs[id])
      .filter((catalog): catalog is StoredOPDSCatalog => !!catalog?.url)
      .map((catalog) =>
        createDescriptor(
          `opds:${catalog.id}`,
          catalog.title || catalog.url,
          "opds",
          catalog.url
        )
      );
  } catch {
    return [];
  }
};

export const getLibrarySourceRegistry = (): LibrarySourceDescriptor[] => [
  createDescriptor(
    "catalog:project-gutenberg",
    "Project Gutenberg",
    "catalog",
    "Public-domain books with EPUB downloads"
  ),
  ...getOPDSCatalogSources(),
  {
    id: "native:weread",
    name: getWeReadConfig().name,
    kind: "native",
    description: "微信读书 API 搜索与目录",
    configured: getWeReadConfig().enabled,
    capabilities: ["search", "read-online"],
  },
  ...getBookSources().map((source) =>
    createDescriptor(
      `web:${source.id}`,
      source.name,
      "web",
      source.description || source.baseUrl,
      source.enabled
    )
  ),
];
