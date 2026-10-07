/** The people who can sign in on a device ("Who are you?"). Order = order on screen. */
export const TEAM = ["Giorgio", "Matteo", "Alice", "Vale M", "Vale V", "Giorgia", "Jessica"] as const;

/**
 * Giorgia and Alice are "clients" in the shared data: work for them is not assigned in the Who field but shows up in
 * a task's status or label ("Notify Giorgia", "Ask OK Alice"), exactly like the old app's Who filter does.
 */
export const CLIENT_PEOPLE = ["Giorgia", "Alice"] as const;

/** Case, spacing and dot insensitive key so "Vale M", "vale m" and "Vale M." are the same person. */
export function personKey(name: unknown): string {
  return String(name ?? "").toLowerCase().replace(/[.\s_-]+/g, "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export function samePerson(a: unknown, b: unknown): boolean {
  const left = personKey(a);
  return left.length > 0 && left === personKey(b);
}

export function isClientPerson(name: unknown): boolean {
  return CLIENT_PEOPLE.some((client) => samePerson(client, name));
}
