// Adapt display names only for the client fragment. Never grant private-profile
// permissions or mutate Hydro's cached user objects to obtain a real name.
export function realNameUsers(
  users: Record<string, any>,
  identities: Array<{ uid: number; realName: string }>,
) {
  const names = new Map(
    identities
      .filter((row) => typeof row.realName === 'string' && row.realName.trim())
      .map((row) => [row.uid, row.realName.trim()]),
  );
  return Object.fromEntries(
    Object.entries(users).map(([id, user]) => {
      if (!user || typeof user !== 'object') {
        return [id, user];
      }
      const name = names.get(user._id) || user.displayName || user.uname;
      const view = Object.create(user);
      Object.defineProperties(view, {
        uname: { value: name, enumerable: true },
        displayName: { value: name, enumerable: true },
      });
      return [id, view];
    }),
  );
}
