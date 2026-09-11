/**
 * The help text, and the slice of it one command owns.
 *
 * `--help` or `-h` anywhere on the line wins before a command runs: a
 * person asking how `login` works must never be put through the device
 * flow. The usage block is one line per command plus indented
 * continuations, so a command's help is the lines that start with its
 * name and whatever hangs under them.
 */

export const HELP = `runlog: author and check rule packs

usage:
  runlog validate <pack...> [--strict]   check a pack's shape and coherence
  runlog bundle   <pack> [-o out.json]   normalize to a distributable JSON
  runlog test     <pack>                 replay the pack's own fixtures
  runlog init     [name]                 scaffold a new pack
  runlog serve    [--port 3535] [--open] run the app from this machine, offline, nothing else installed
  runlog docs     <pack> [-o dir]        write its rulebook, quick start, reference card,
                    [--only kinds]         run log sheet and marketplace summary (HTML and Markdown)
  runlog keygen   [-o key.json]          make a signing key for your packs
  runlog sign     <pack> --key key.json  sign a pack, proving you wrote it
  runlog issue    <pack> --to "Name"     stamp a copy with a buyer's name and sign it
                    [--seal]             …and seal it, so it needs a license key to open
                                         (both take the key from RUNLOG_SIGNING_KEY instead)

  runlog login    [--api URL]            sign in: a code to confirm in your browser
                    [--key]              …or paste a key from your profile page, for a machine with no browser
  runlog whoami                          who the command line is acting as
  runlog claim    key.json               prove a signing key is yours; the app then names you
  runlog upload   <pack>                 put a pack in your own library, private to your
                    (was: publish)         account, on every device you are signed in on
  runlog release  <pack> [--price 3.00]  put a signed pack in the marketplace, where anyone can
                    [--free] [--draft]     find it, as its publisher; no flag keeps the listing
  runlog logout                          forget the sign-in

--strict makes warnings fail, which is what you want in CI. In CI, set
RUNLOG_API_KEY to a key from your profile page instead of running login,
and RUNLOG_SIGNING_KEY to your key file's contents instead of --key; nobody
is there to confirm a code. examples/github-actions in the repository has
workflows to copy.

Signing proves authorship. It does not restrict copying and cannot: the app
has to read every word of a pack to play it. What it gives you is that an
altered copy can no longer claim to be yours, and, once the key is claimed
by your account, that the app names you beside it. sign and issue refuse a
key that is not claimed.
`;

/** True when the line asks for help, wherever the flag sits before a `--`. */
export function asksForHelp(args: string[]): boolean {
  for (const a of args) {
    if (a === "--") return false;
    if (a === "--help" || a === "-h") return true;
  }
  return false;
}

/**
 * The usage lines for one command, or the whole text for a name the usage
 * block does not carry (an alias, or a command with none).
 */
export function helpFor(command: string): string {
  const lines = HELP.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`  runlog ${command} `));
  if (start < 0) return HELP;
  const block = [lines[start]!];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    // A continuation is indented past the command column; anything else ends it.
    if (!/^ {4,}\S/.test(line) || /^  runlog /.test(line)) break;
    block.push(line);
  }
  return `usage:\n${block.join("\n")}\n\nrunlog help for the rest.`;
}
