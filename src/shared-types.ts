// Types that say the same thing are written once. Used for the query and
// variable types of a tag, and for the models: an identical type becomes an
// alias of the first, and (optionally) a close one is derived from it.

interface Prop {
  optional: boolean;
  type: string;
  lines: string[];
}

type Props = Map<string, Prop>;

/** A type already written, which a later one may be derived from. */
interface Candidate {
  name: string;
  props: Props;
}

/** `{ key: { optional, type, lines } }` of an object type body, or null. */
function parseObjectBody(body: string): Props | null {
  const props: Props = new Map();
  let doc: string[] = [];
  for (const line of body.split("\n").slice(1, -1)) {
    if (/^\s*\/\*\*.*\*\/$/.test(line)) {
      doc = [line];
      continue;
    }
    const prop = /^\s+("[^"]+"|[\w$]+)(\?)?: (.+);$/.exec(line);
    if (!prop) return null;
    props.set(prop[1], {
      optional: Boolean(prop[2]),
      type: prop[3],
      lines: [...doc, line],
    });
    doc = [];
  }
  return props;
}

/**
 * `Omit<Owner, …> & { … }` when `props` is the owner's shape with only a few
 * properties changed, added or removed; null when it is not close enough.
 */
function deriveFrom(
  owner: Candidate,
  props: Props,
): { differing: number; text: string } | null {
  const keys = new Set([...owner.props.keys(), ...props.keys()]);
  const removed: string[] = [];
  const written: string[] = [];
  let common = 0;
  for (const key of keys) {
    const before = owner.props.get(key);
    const after = props.get(key);
    if (!after) removed.push(key);
    else if (!before) written.push(key);
    else if (before.optional !== after.optional || before.type !== after.type)
      (written.push(key), removed.push(key));
    else common += 1;
  }
  const differing = new Set([...removed, ...written]).size;
  if (common < 4 || differing > Math.max(1, Math.floor(keys.size / 4)))
    return null;
  const base = removed.length
    ? `Omit<${owner.name}, ${removed.map((key) => (key.startsWith('"') ? key : `"${key}"`)).join(" | ")}>`
    : owner.name;
  const extra = written.flatMap((key) => props.get(key)?.lines ?? []);
  return {
    differing,
    text: extra.length ? `${base} & {\n${extra.join("\n")}\n}` : base,
  };
}

export function shareIdenticalTypes(
  blocks: string[],
  related: (a: string, b: string) => boolean = () => true,
  derive = false,
): string[] {
  // Types with the same shape are written once; the later ones alias the
  // first, so a field added to the backend lands in a single place. Doc
  // comments are not part of the shape, and only types `related` says belong
  // together are merged — two entities that merely look alike stay apart.
  // With `derive`, a type that differs from an earlier one in only a few
  // properties is written as that type with those properties changed.
  const owners = new Map<string, string[]>();
  const closest: Candidate[] = [];
  return blocks.map((block) => {
    const match =
      /^((?:\/\*\*.*\*\/\n)?)export type (\w+) = (\{[\s\S]*\});$/.exec(block);
    if (!match) return block;
    const shape = match[3].replace(/^\s*\/\*\*.*\*\/\n/gm, "");
    const names = owners.get(shape) ?? [];
    const owner = names.find((name) => related(name, match[2]));
    if (owner) return `${match[1]}export type ${match[2]} = ${owner};`;

    const props = derive ? parseObjectBody(match[3]) : null;
    if (props) {
      const best = closest
        .map((candidate) => deriveFrom(candidate, props))
        .filter((derived) => derived !== null)
        .sort((a, b) => a.differing - b.differing)[0];
      if (best) return `${match[1]}export type ${match[2]} = ${best.text};`;
      closest.push({ name: match[2], props });
    }
    owners.set(shape, [...names, match[2]]);
    return block;
  });
}
