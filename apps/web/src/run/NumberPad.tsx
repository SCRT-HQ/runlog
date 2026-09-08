/**
 * The digits a player taps when they have rolled real dice and are typing
 * the result in: 0-9 and a backspace. Shared by the request panel and the
 * floating remote, so the pad itself cannot drift between the two places it
 * appears.
 */
export function NumberPad({
  onDigit,
  onBackspace,
  disabled,
}: {
  onDigit: (n: number) => void;
  onBackspace: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="pad">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => (
        <button key={n} className="key" disabled={disabled} onClick={() => onDigit(n)}>
          {n}
        </button>
      ))}
      <button className="key wide" disabled={disabled} onClick={onBackspace}>
        ←
      </button>
    </div>
  );
}
