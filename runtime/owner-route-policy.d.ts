export declare const ownerForbiddenHrefPrefixes: string[];
export declare function isOwnerForbiddenHref(href: string): boolean;
export declare function ownerSafeHref(href: string, adminMode?: boolean): string;
export declare function ownerSafeHrefs(
  hrefs: string[],
  adminMode?: boolean,
): string[];
