export type LibrarySourceKind = "catalog" | "opds" | "web" | "native";

export type LibrarySourceCapability = "search" | "download" | "read-online";

export interface LibrarySourceDescriptor {
  id: string;
  name: string;
  kind: LibrarySourceKind;
  description: string;
  capabilities: LibrarySourceCapability[];
  configured: boolean;
}
