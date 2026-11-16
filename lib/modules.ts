export type ModuleKey =
  | "ask"
  | "networking"
  | "engagement"
  | "want_to_know";

export type ModuleDefinition = {
  key: ModuleKey;
  label: string;
  href: string;
  description: string;
  defaultEnabled: boolean;
};

export const featureModules: ModuleDefinition[] = [
  {
    key: "ask",
    label: "Ask",
    href: "/ask",
    description: "Search and query the private relationship database.",
    defaultEnabled: true,
  },
  {
    key: "networking",
    label: "Networking",
    href: "/networking",
    description: "Warm paths, introductions, promises, and relationship flow.",
    defaultEnabled: true,
  },
  {
    key: "engagement",
    label: "Engagement",
    href: "/engagement",
    description: "Outreach rhythm, social pulse, and follow-up prompts.",
    defaultEnabled: true,
  },
  {
    key: "want_to_know",
    label: "Want to Know",
    href: "/want-to-know",
    description: "People the executive wants to meet or understand better.",
    defaultEnabled: true,
  },
];

export const ownerNavigationModuleKeys: ModuleKey[] = [
  "networking",
  "engagement",
  "want_to_know",
];

export function getEnabledModuleKeys(settings: unknown) {
  const root =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as { modules?: Partial<Record<ModuleKey, boolean>> })
      : {};
  const modules = root.modules;

  return featureModules
    .filter((module) => modules?.[module.key] ?? module.defaultEnabled)
    .map((module) => module.key);
}

export function getModuleRows(settings: unknown) {
  const enabledKeys = new Set(getEnabledModuleKeys(settings));

  return featureModules.map((module) => ({
    ...module,
    enabled: enabledKeys.has(module.key),
  }));
}

export function isModuleEnabled(settings: unknown, key: ModuleKey) {
  return getEnabledModuleKeys(settings).includes(key);
}
